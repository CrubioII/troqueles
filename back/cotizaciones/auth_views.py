from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from . import roles


def _claims_rol(user):
    # Estaciones/módulos del Operador (vacío/irrelevante para el Admin, que ya
    # tiene el bypass por role=admin en el front). Ver cotizaciones/roles.py.
    return {
        "estaciones": sorted(roles.estaciones_permitidas(user)),
        "troqueles": roles.puede_troqueles(user),
        "remisiones_generales": roles.puede_remisiones_generales(user),
    }


class CustomTokenSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        # Claims en el token: el frontend puede restaurar la sesión decodificando
        # el access token, sin llamar a /auth/me/ en cada arranque.
        token = super().get_token(user)
        token["role"] = "admin" if user.is_staff else "operador"
        token["username"] = user.username
        for k, v in _claims_rol(user).items():
            token[k] = v
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["role"] = "admin" if self.user.is_staff else "operador"
        data["username"] = self.user.username
        data.update(_claims_rol(self.user))
        return data


class LoginView(TokenObtainPairView):
    permission_classes = [AllowAny]
    serializer_class = CustomTokenSerializer


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "username": request.user.username,
            "role": "admin" if request.user.is_staff else "operador",
            **_claims_rol(request.user),
        })
