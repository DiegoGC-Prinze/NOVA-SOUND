"""Cliente HTTP estandar Python. Nunca conecta directo con PostgreSQL."""
from __future__ import annotations
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


class ApiError(RuntimeError):
    def __init__(self, status, route, detail):
        self.status, self.route, self.detail = status, route, detail
        super().__init__(f'HTTP {status} {route}: {detail}')


class Cliente:
    def __init__(self, base_url, sim_key):
        p=urlparse(base_url.rstrip('/'))
        if p.scheme != 'http' or p.hostname not in ('127.0.0.1','localhost') or p.port != 8001 or p.path not in ('','/'):
            raise ValueError('SEGURIDAD: el cliente solo admite http://127.0.0.1:8001')
        if not sim_key:
            raise ValueError('Falta la clave exclusiva del entorno simulado')
        self.base=p.scheme+'://'+p.netloc
        self.sim_key=sim_key
        self.tokens={}
        self.fecha_simulada=None  # NOVA_SIM_CLOCK_V2

    def req(self, method, path, data=None, perfil=None, sim=False):
        if not path.startswith('/') or path.startswith('//') or not path.startswith('/api/v1/'):
            raise ValueError('Se requiere una ruta /api/v1/ valida')
        headers={'Accept':'application/json'}
        if data is not None:
            headers['Content-Type']='application/json'
        if perfil:
            headers['Authorization']='Bearer '+self.tokens[perfil]
        if sim:
            headers['X-Simulation-Key']=self.sim_key
        if self.fecha_simulada and path.startswith('/api/v1/gestion/operacion'):
            headers['X-Simulation-Date']=self.fecha_simulada
            headers['X-Simulation-Key']=self.sim_key
        payload=json.dumps(data,ensure_ascii=False).encode('utf-8') if data is not None else None
        req=Request(self.base+path, data=payload, headers=headers, method=method)
        try:
            with urlopen(req, timeout=45) as resp:
                content=resp.read()
                return json.loads(content.decode('utf-8')) if content else None
        except HTTPError as e:
            message=e.read(3000).decode('utf-8','replace')
            try:
                message=json.loads(message).get('detail',message)
            except (ValueError,AttributeError):
                pass
            raise ApiError(e.code,path,message) from e
        except URLError as e:
            raise ApiError(0,path,str(e.reason)) from e

    def get(self,path,perfil,sim=False):return self.req('GET',path,perfil=perfil,sim=sim)
    def post(self,path,data,perfil,sim=False):return self.req('POST',path,data,perfil=perfil,sim=sim)
    def login(self,usuario,password,perfil):
        r=self.req('POST','/api/v1/auth/login',{'usuario':usuario,'contrasena':password})
        if not r.get('token') or r.get('modo')!='real':
            raise RuntimeError('Inicio de sesion sin token o no conectado a PostgreSQL')
        self.tokens[perfil]=r['token']
        return r
