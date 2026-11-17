import pytest
from fastapi import HTTPException
from app.core.sesiones import hash_password, verificar_password, permisos_almacen, identificar_token


def test_password_scrypt_y_compatibilidad_seed():
    password = 'Contraseña-real-123'
    digest = hash_password(password)
    assert digest.startswith('scrypt$') and digest != password
    assert verificar_password(password, digest)
    assert not verificar_password('incorrecta', digest)
    assert verificar_password('pass123', 'pass123')
    assert not verificar_password('pass124', 'pass123')
    assert not verificar_password('algo', 'scrypt$no-valido$hash')


def test_permisos_operador_supervisor_y_roles_no_operativos():
    permisos, acciones = permisos_almacen('Almacén/Empaque')
    assert permisos['empaque/formar-caja'] == 'acciona'
    assert 'cerrar-caja' in acciones and 'reabrir-caja' not in acciones
    permisos, acciones = permisos_almacen('Supervisor de almacén')
    assert permisos['empaque/consultar-caja'] == 'acciona'
    assert 'empaque/formar-caja' not in permisos
    assert acciones == ['reabrir-caja']
    with pytest.raises(HTTPException) as exc:
        permisos_almacen('Operador')
    assert exc.value.status_code == 403


def test_token_invalido_no_consulta_base():
    with pytest.raises(HTTPException) as exc:
        identificar_token('mock-4001')
    assert exc.value.status_code == 401
