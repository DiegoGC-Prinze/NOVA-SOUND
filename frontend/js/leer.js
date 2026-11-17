// Lee un archivo de texto del propio proyecto (css/tema.css, mock/*.json).
// Con servidor (http) usa fetch. Si la página se abrió con doble clic (file://), fetch no puede
// leer archivos, así que se usa XMLHttpRequest, que sí puede (ver ABRIR-SIN-SERVIDOR.bat).

export function leerArchivo(url) {
  if (url.protocol !== 'file:') {
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error(`No se encontró ${url.pathname}`);
      return r.text();
    });
  }
  return new Promise((resolver, rechazar) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url.href);
    xhr.onload = () => resolver(xhr.responseText);
    xhr.onerror = () => rechazar(new Error(`No se pudo leer ${url.pathname}`));
    xhr.send();
  });
}
