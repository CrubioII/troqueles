from django.test import SimpleTestCase

from correos.reglas.clientes import REGLAS_EXCLUSIVAS, resolver_cliente


class ReglasExclusivasTests(SimpleTestCase):
    """Un caso por cada fila de la tabla de reglas (spec 6.3, Paso 2)."""

    def test_impresos_richard_por_dominio(self):
        r = resolver_cliente("produccion@impresosrichard.com", "Producción Richard", "")
        self.assertEqual(r.nombre, "Impresos Richard")
        self.assertEqual(r.flag, "multipagina")

    def test_impresos_richard_por_correo_exacto(self):
        r = resolver_cliente("nelsonmontes@impresosrichard.com", "Nelson Montes", "")
        self.assertEqual(r.nombre, "Impresos Richard")

    def test_grupo_estelar_por_dominio(self):
        r = resolver_cliente("alguien@estelarimpresores.com", "Alguien", "")
        self.assertEqual(r.nombre, "Grupo Estelar")

    def test_grupo_estelar_por_nombre(self):
        r = resolver_cliente("otro@gmail.com", "Carlos A. Bernal", "")
        self.assertEqual(r.nombre, "Grupo Estelar")

    def test_compucopiamos_por_correo(self):
        r = resolver_cliente("monicompucopiamos@gmail.com", "Monica", "")
        self.assertEqual(r.nombre, "COMPUCOPIAMOS")

    def test_compucopiamos_por_nombre(self):
        r = resolver_cliente("otro@gmail.com", "Monica V. Arrieta", "")
        self.assertEqual(r.nombre, "COMPUCOPIAMOS")

    def test_flexocar_por_dominio(self):
        r = resolver_cliente("ventas@flexocar.com", "Ventas", "")
        self.assertEqual(r.nombre, "Flexocar")

    def test_flexocar_por_correo_personal(self):
        r = resolver_cliente("josefergarcia1@gmail.com", "Jose", "")
        self.assertEqual(r.nombre, "Flexocar")

    def test_flexocar_por_nombre(self):
        r = resolver_cliente("otro@gmail.com", "Jose Fernando Garcia Valencia", "")
        self.assertEqual(r.nombre, "Flexocar")

    def test_prepensa_inalmega(self):
        r = resolver_cliente("preprensa@inalmega.com", "Wilson Barrera", "")
        self.assertEqual(r.nombre, "Preprensa Inalmega")

    def test_fgt_por_dominio(self):
        r = resolver_cliente("alguien@fgt.com.co", "Alguien", "")
        self.assertEqual(r.nombre, "FGT")

    def test_fgt_por_nombre(self):
        r = resolver_cliente("otro@gmail.com", "Diana Osorio", "")
        self.assertEqual(r.nombre, "FGT")

    def test_interbags(self):
        r = resolver_cliente("servicioalcliente@interbags.com.co", "Servicio", "")
        self.assertEqual(r.nombre, "Interbags")

    def test_litoruiz_por_dominio(self):
        r = resolver_cliente("alguien@litoruiz.com", "Alguien", "")
        self.assertEqual(r.nombre, "Litoruiz")

    def test_litoruiz_por_nombre(self):
        r = resolver_cliente("otro@gmail.com", "Henry Quintero", "")
        self.assertEqual(r.nombre, "Litoruiz")

    def test_inmcor_por_dominio(self):
        r = resolver_cliente("compras@inmcor.com", "Compras", "")
        self.assertEqual(r.nombre, "Inmcor")
        self.assertEqual(r.flag, "es_inmcor")

    def test_inmcor_por_nombre(self):
        r = resolver_cliente("otro@gmail.com", "Javier Galindo", "")
        self.assertEqual(r.nombre, "Inmcor")
        self.assertEqual(r.flag, "es_inmcor")

    def test_ingenieria_grafica_dominio_co(self):
        r = resolver_cliente("produccion@igpack.co", "Produccion", "")
        self.assertEqual(r.nombre, "Ingeniería Gráfica")

    def test_ingenieria_grafica_dominio_com(self):
        r = resolver_cliente("alguien@igpack.com", "Alguien", "")
        self.assertEqual(r.nombre, "Ingeniería Gráfica")

    def test_ingenieria_grafica_por_nombre(self):
        r = resolver_cliente("otro@gmail.com", "Carlos Valencia", "")
        self.assertEqual(r.nombre, "Ingeniería Gráfica")

    def test_graficas_modernas_por_dominio(self):
        r = resolver_cliente("diseno@graficasmodernas.com", "Diseño", "")
        self.assertEqual(r.nombre, "Graficas Modernas")
        self.assertEqual(r.flag, "filtra_orden")

    def test_graficas_modernas_por_nombre(self):
        r = resolver_cliente("otro@gmail.com", "Juan Carlos Arias", "")
        self.assertEqual(r.nombre, "Graficas Modernas")

    def test_tabla_tiene_once_reglas(self):
        self.assertEqual(len(REGLAS_EXCLUSIVAS), 11)


class AlexanderTests(SimpleTestCase):
    def test_alexander_por_email_gerencia_con_instruccion(self):
        r = resolver_cliente(
            "gerenciatroquelesinc@gmail.com", "Alexander",
            "Buenos días\nCliente: Armonia Impresores\nGracias",
        )
        self.assertEqual(r.nombre, "Armonia Impresores")
        self.assertEqual(r.nota_cliente, "")
        self.assertEqual(r.alerta, "")

    def test_alexander_por_email_lineas_con_instruccion(self):
        r = resolver_cliente(
            "troquelesinclineas@gmail.com", "Alexander",
            "Cliente: Neko The Best",
        )
        self.assertEqual(r.nombre, "Neko The Best")

    def test_alexander_por_nombre(self):
        r = resolver_cliente(
            "otro.correo@gmail.com", "Alexander Restrepo",
            "Cliente: Distribuidora XYZ",
        )
        self.assertEqual(r.nombre, "Distribuidora XYZ")

    def test_alexander_con_nota_entre_parentesis(self):
        r = resolver_cliente(
            "gerenciatroquelesinc@gmail.com", "Alexander",
            "Cliente: Armonia impresores (fabricar cab 2)",
        )
        self.assertEqual(r.nombre, "Armonia impresores")
        self.assertEqual(r.nota_cliente, "fabricar cab 2")

    def test_alexander_con_nota_entre_corchetes(self):
        r = resolver_cliente(
            "gerenciatroquelesinc@gmail.com", "Alexander",
            "Cliente: Empresa ABC [urgente]",
        )
        self.assertEqual(r.nombre, "Empresa ABC")
        self.assertEqual(r.nota_cliente, "urgente")

    def test_alexander_con_nota_entre_llaves(self):
        r = resolver_cliente(
            "gerenciatroquelesinc@gmail.com", "Alexander",
            "Cliente: Empresa ABC {revisar medidas}",
        )
        self.assertEqual(r.nombre, "Empresa ABC")
        self.assertEqual(r.nota_cliente, "revisar medidas")

    def test_alexander_sin_instruccion_no_crea_nada(self):
        # No reintroducir el fallback que causó OP-0550/OP-0557.
        r = resolver_cliente("gerenciatroquelesinc@gmail.com", "Alexander", "Buenos días, adjunto el troquel.")
        self.assertIsNone(r.nombre)
        self.assertTrue(r.alerta)

    def test_alexander_cuerpo_vacio_no_crea_nada(self):
        r = resolver_cliente("gerenciatroquelesinc@gmail.com", "Alexander", "")
        self.assertIsNone(r.nombre)

    def test_solo_alexander_puede_usar_linea_cliente(self):
        # Un remitente cualquiera con "Cliente: xxx" en el cuerpo NO debe
        # activar el atajo de Alexander — la línea se ignora y sigue la cadena.
        r = resolver_cliente(
            "cualquiera@gmail.com", "Cualquiera",
            "Cliente: Deberia Ser Ignorado",
        )
        self.assertNotEqual(r.nombre, "Deberia Ser Ignorado")
        self.assertEqual(r.nombre, "Cualquiera")


class DominioPropioTests(SimpleTestCase):
    """Paso 3."""

    def test_dominio_propio_sin_regla(self):
        r = resolver_cliente("info@nuevaempresa.com.co", "Info", "")
        self.assertEqual(r.nombre, "Nuevaempresa")

    def test_dominio_propio_capitaliza(self):
        r = resolver_cliente("contacto@ACME.COM", "Contacto", "")
        self.assertEqual(r.nombre, "Acme")


class DominioPublicoConAliasTests(SimpleTestCase):
    """Paso 4."""

    def test_alias_del_remitente(self):
        r = resolver_cliente("ivappublicidad@gmail.com", "Neko The Best", "")
        self.assertEqual(r.nombre, "Neko The Best")

    def test_alias_vacio_cae_a_paso_5(self):
        r = resolver_cliente("juan.perez@hotmail.com", "", "")
        self.assertEqual(r.nombre, "Juan Perez")

    def test_alias_igual_al_correo_cae_a_paso_5(self):
        r = resolver_cliente("juan.perez@hotmail.com", "juan.perez@hotmail.com", "")
        self.assertEqual(r.nombre, "Juan Perez")

    def test_alias_con_arroba_cae_a_paso_5(self):
        r = resolver_cliente("juan.perez@hotmail.com", "algo@raro", "")
        self.assertEqual(r.nombre, "Juan Perez")


class ParteLocalTests(SimpleTestCase):
    """Paso 5."""

    def test_parte_local_limpia(self):
        r = resolver_cliente("juan.perez@hotmail.com", "", "")
        self.assertEqual(r.nombre, "Juan Perez")

    def test_parte_local_con_guiones_y_numeros(self):
        r = resolver_cliente("maria-lopez_92@yahoo.com", "", "")
        self.assertEqual(r.nombre, "Maria Lopez 92")


class SinRemitenteTests(SimpleTestCase):
    """Paso 6."""

    def test_sin_remitente_legible(self):
        r = resolver_cliente("", "", "")
        self.assertEqual(r.nombre, "Unresolved")
        self.assertTrue(r.alerta)
