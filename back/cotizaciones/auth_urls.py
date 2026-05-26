from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .auth_views import LoginView, MeView

urlpatterns = [
    path("login/", LoginView.as_view(), name="auth_login"),
    path("refresh/", TokenRefreshView.as_view(), name="auth_refresh"),
    path("me/", MeView.as_view(), name="auth_me"),
]
