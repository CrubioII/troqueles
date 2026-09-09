# Infraestructura AWS del backend

El backend corre como un **Lightsail Container Service** en **us-east-2 (Ohio)** — la misma
región que el pooler de Supabase, así que la latencia a la base de datos es de la misma región.
La imagen vive en **ECR privado**. El despliegue es automático: cada push a `main` que toque
`back/**` dispara `.github/workflows/deploy-backend.yml`.

| Pieza | Valor |
|---|---|
| API producción | `https://troqueles-api.f3pqpvq8822ng.us-east-2.cs.amazonlightsail.com` |
| Container service | `troqueles-api` · power `small` (0.5 vCPU, 1.5 GB) · scale 1 · us-east-2 |
| Imagen | `351473832155.dkr.ecr.us-east-2.amazonaws.com/troqueles-back:<git-sha>` |
| Health check | `GET /healthz` → `{"ok": true}` (ver `back/config/urls.py`) |
| Base de datos | Supabase Postgres (vars `DB_*`) — **no** está en esta cuenta de AWS |
| Media | Azure Blob Storage (`AZURE_STORAGE_CONNECTION_STRING`) — **no** migrada |
| Frontend | Azure Static Web Apps — solo apunta su `VITE_API_URL` aquí |

## Por qué Lightsail y no App Runner / ECS

El contenedor no es solo gunicorn: `back/start.sh` levanta además `cron` (respaldo de
`procesar_correos`) y el listener IMAP IDLE (`run_escuchar_correos.sh`) en segundo plano.
App Runner estrangula la CPU entre requests y mataría ambos procesos; ECS + ALB cuesta el
doble por el balanceador. Lightsail da CPU siempre activa, una sola instancia y HTTPS con
hostname propio sin necesidad de dominio ni certificado de ACM.

Consecuencia a tener presente: **una sola instancia es parte del diseño**. Subir `scale`
por encima de 1 duplicaría el listener IMAP y los cron jobs.

## Dónde viven los secretos

Las ~20 variables de producción (`SECRET_KEY`, `DB_*`, `EMAIL_*`, `IMAP_PASSWORD`,
`TELEGRAM_*`, `AZURE_STORAGE_CONNECTION_STRING`, `N8N_API_*`) viven **solo** en el
deployment de Lightsail. No están en el repo ni en los secretos de GitHub.

Por eso el workflow no arma el spec desde cero: lee el despliegue vivo con
`get-container-service-deployments`, le cambia únicamente `containers.back.image`, y lo
reenvía. Si algún día el spec llegara sin variables, el paso aborta antes de desplegar
(un contenedor sin `DB_*` arrancaría contra sqlite y perdería los datos de la corrida).

### Cambiar una variable de entorno

```sh
aws lightsail get-container-service-deployments --service-name troqueles-api \
  --region us-east-2 --query 'deployments[0]' > /tmp/dep.json
# editar containers.back.environment en /tmp/dep.json, luego recortar al shape de entrada:
jq '{serviceName:"troqueles-api", containers, publicEndpoint:{containerName:.publicEndpoint.containerName,
     containerPort:.publicEndpoint.containerPort, healthCheck:.publicEndpoint.healthCheck}}' \
  /tmp/dep.json > /tmp/deployment.json
aws lightsail create-container-service-deployment --region us-east-2 \
  --cli-input-json file:///tmp/deployment.json
rm /tmp/dep.json /tmp/deployment.json
```

`GUNICORN_WORKERS` es la palanca para bajar de 3 a 2 workers sin reconstruir la imagen
(el nodo tiene la mitad de vCPU que el App Service B1 de Azure que reemplazó).

## Cómo se creó (una sola vez)

```sh
REGION=us-east-2

# 1. Registro de la imagen
aws ecr create-repository --repository-name troqueles-back --region $REGION \
  --image-scanning-configuration scanOnPush=true
aws ecr put-lifecycle-policy --repository-name troqueles-back --region $REGION \
  --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"Conservar solo las ultimas 10 imagenes","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}'

# 2. El servicio
aws lightsail create-container-service --service-name troqueles-api \
  --power small --scale 1 --region $REGION

# 3. Dejar que Lightsail lea el ECR privado. Genera un rol; su principal hay que
#    autorizarlo en la repository policy del ECR (evita depender de lightsailctl).
aws lightsail update-container-service --service-name troqueles-api --region $REGION \
  --private-registry-access 'ecrImagePullerRole={isActive=true}'
aws lightsail get-container-services --service-name troqueles-api --region $REGION \
  --query 'containerServices[0].privateRegistryAccess.ecrImagePullerRole.principalArn'
# -> usar ese ARN como Principal en aws ecr set-repository-policy (BatchGetImage +
#    GetDownloadUrlForLayer)

# 4. Usuario IAM del CI (llaves en los secretos AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#    del repo). Permisos: ecr:GetAuthorizationToken (*), push/pull sobre el repo
#    troqueles-back, y lightsail:{GetContainerServices,GetContainerServiceDeployments,
#    GetContainerLog,CreateContainerServiceDeployment}.
aws iam create-user --user-name github-actions-troqueles
```

La **primera** imagen se sembró con `gh workflow run deploy-backend.yml -f deploy=false`
(construye y empuja a ECR sin desplegar), y el primer deployment se creó a mano con el JSON
completo de variables. De ahí en adelante el CI solo intercambia la imagen.

## Operación

```sh
# Estado y URL
aws lightsail get-container-services --service-name troqueles-api --region us-east-2

# Logs del contenedor (gunicorn, cron, listener IMAP: todo va a stdout/stderr)
aws lightsail get-container-log --service-name troqueles-api --container-name back \
  --region us-east-2 --start-time "$(date -u -v-1H +%s)"

# Vida
curl -s https://troqueles-api.f3pqpvq8822ng.us-east-2.cs.amazonlightsail.com/healthz

# CPU y memoria del nodo. Sirve para decidir si hay que subir de power o bajar
# GUNICORN_WORKERS: en reposo el contenedor va en ~33% de memoria y ~1.5% de CPU
# con 3 workers, y el pico de CPU al desplegar es el warmup de WeasyPrint.
aws lightsail get-container-service-metric-data --service-name troqueles-api \
  --region us-east-2 --metric-name MemoryUtilization --period 300 --statistics Average Maximum \
  --start-time "$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

El listener de correos solo escribe al arrancar, al conectarse, al correr un
lote y al fallar: no tiene latido por ciclo, así que su silencio en los logs es
el estado sano. Lo que hay que buscar es una línea `[correos-listener] Error:`.

## Reversa

El App Service de Azure (`troqueles-api-jp` en `troqueles-rg`) quedó **detenido, no borrado**.
Para volver: `az webapp start -n troqueles-api-jp -g troqueles-rg` y revertir `VITE_API_URL`
en `front/.env.production` y en el workflow de Static Web Apps. Mientras el plan B1 y el ACR
sigan existiendo, siguen facturando aunque la app esté detenida.
