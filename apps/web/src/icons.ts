// Bagsy mark: the site favicon, in the same ink-on-highlight palette as the
// pages themselves (see --highlight / --on-highlight in web/html.ts).
//
// The "b" is drawn geometrically (a stem rect plus a stroked bowl) instead of as
// <text>, so it renders identically everywhere without depending on a system
// font. The raster fallbacks below were generated from this exact geometry and
// only exist for clients that will not take an SVG icon.

export const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" fill="#ffe34d"/>
  <rect x="7.75" y="4.5" width="4.5" height="22.5" fill="#111111"/>
  <circle cx="17.25" cy="19.25" r="6" fill="none" stroke="#111111" stroke-width="4.5"/>
</svg>`;

const ICO_BASE64 =
  "AAABAAIAEBAAAAEAIABoBAAAJgAAACAgAAABACAAqBAAAI4EAAAoAAAAEAAAACAAAAABACAAAAAAAAAEAAAAAAAAAAAAAAAA" +
  "AAAAAAAATeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9J1vD/L3qI/y96iP8/s8j/Kml0/yBHTv8mXGb/PKe7/03j//9N4///TeP//03j//9N4///TeP//03j//9N4///Rsnh/xER" +
  "Ef8RERH/ERIS/xEREf8RERH/ERER/xEREf8rbnr/TeP//03j//9N4///TeP//03j//9N4///TeP//0bJ4f8RERH/ERER/xER" +
  "Ef8aMDT/LXSB/yBGTf8RERH/ERER/zynu/9N4///TeP//03j//9N4///TeP//03j//9GyeH/ERER/xEREf8VHyH/SdXv/03j" +
  "//9N4v7/IEZN/xEREf8mXGb/TeP//03j//9N4///TeP//03j//9N4///Rsnh/xEREf8RERH/HkBG/03j//9N4///TeP//y10" +
  "gf8RERH/IEdO/03j//9N4///TeP//03j//9N4///TeP//0bJ4f8RERH/ERER/xIWF/9Cu9H/TeP//0nV7/8aMDT/ERER/ypp" +
  "dP9N4///TeP//03j//9N4///TeP//03j//9GyeH/ERER/xEREf8RERH/EhYX/x5ARv8VHyH/ERER/xIWF/9DwNf/TeP//03j" +
  "//9N4///TeP//03j//9N4///Rsnh/xEREf8RERH/FiMl/xEREf8RERH/ERER/xQcHf85nbD/TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//0bJ4f8RERH/ERER/0TC2v85nbD/L3yK/zWQof9I0ev/TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9GyeH/ERER/xEREf9GyeH/TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///Rsnh/xER" +
  "Ef8RERH/Rsnh/03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//0fP6f8gRk3/IEZN/0fP" +
  "6f9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAoAAAAIAAAAEAAAAABACAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAATeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//0nX8f87o7b/MYGQ/y97if81j6D/QrzT/03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//8+r8T/ERER/xEREf8RERH/ERER/zmdsP8qZ3P/ExgY/xEREf8RERH/ERER/xEREf8RERH/GzU6/zqhtf9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//z6vxP8RERH/ERER/xER" +
  "Ef8RERH/EhYX/xEREf8RERH/ERER/xEREf8RERH/ERER/xEREf8RERH/ERER/ylkb/9M4fz/TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///Pq/E/xEREf8RERH/ERER/xEREf8RERH/ERER/xER" +
  "Ef8RERH/ERER/xEREf8RERH/ERER/xEREf8RERH/ERER/ylkb/9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//8+r8T/ERER/xEREf8RERH/ERER/xEREf8RERH/ERER/xEREf8RERH/ERER/xER" +
  "Ef8RERH/ERER/xEREf8RERH/ERER/zqhtf9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//z6vxP8RERH/ERER/xEREf8RERH/ERER/xEREf8TGRr/MoST/0jR6/9M4Pv/P7PI/yBFTP8RERH/ERER/xER" +
  "Ef8RERH/GzU6/03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///Pq/E/xER" +
  "Ef8RERH/ERER/xEREf8RERH/ERIS/zyovP9N4///TeP//03j//9N4///TN75/yBFTP8RERH/ERER/xEREf8RERH/QrzT/03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//8+r8T/ERER/xEREf8RERH/ERER/xER" +
  "Ef8hSlH/TeP//03j//9N4///TeP//03j//9N4///P7PI/xEREf8RERH/ERER/xEREf81j6D/TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//z6vxP8RERH/ERER/xEREf8RERH/ERER/y53hP9N4///TeP//03j" +
  "//9N4///TeP//03j//9M4Pv/ERER/xEREf8RERH/ERER/y97if9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///Pq/E/xEREf8RERH/ERER/xEREf8RERH/Kmh0/03j//9N4///TeP//03j//9N4///TeP//0jR" +
  "6/8RERH/ERER/xEREf8RERH/MYGQ/03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//8+r8T/ERER/xEREf8RERH/ERER/xEREf8XJSf/Stn0/03j//9N4///TeP//03j//9N4///MoST/xEREf8RERH/ERER/xER" +
  "Ef87o7b/TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//z6vxP8RERH/ERER/xER" +
  "Ef8RERH/ERER/xEREf8jUVr/Stn0/03j//9N4///TeP//zyovP8TGRr/ERER/xEREf8RERH/ExgY/0nX8f9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///Pq/E/xEREf8RERH/ERER/xEREf8RERH/ERER/xER" +
  "Ef8XJSf/Kmh0/y53hP8hSlH/ERIS/xEREf8RERH/ERER/xEREf8qZ3P/TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//8+r8T/ERER/xEREf8RERH/ERER/xEREf8RERH/ERER/xEREf8RERH/ERER/xER" +
  "Ef8RERH/ERER/xEREf8RERH/FyUn/0jS6/9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//z6vxP8RERH/ERER/xEREf8RERH/ERER/xEREf8RERH/ERER/xEREf8RERH/ERER/xEREf8RERH/ERER/xUd" +
  "H/9At83/TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///Pq/E/xER" +
  "Ef8RERH/ERER/xEREf8kU1z/ExcY/xEREf8RERH/ERER/xEREf8RERH/ERER/xEREf8dOj//Q8HY/03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//8+r8T/ERER/xEREf8RERH/ERER/z6v" +
  "xP9GyuP/LXSB/x06P/8TGBn/ERIS/xcmKf8kU1z/OZ6x/03h/f9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//z6vxP8RERH/ERER/xEREf8RERH/Pq/E/03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///Pq/E/xEREf8RERH/ERER/xEREf8+r8T/TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//8+r8T/ERER/xEREf8RERH/ERER/z6vxP9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//z6vxP8RERH/ERER/xER" +
  "Ef8RERH/Pq/E/03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///Pq/E/xEREf8RERH/ERER/xEREf8+r8T/TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//8+r8T/ERER/xEREf8RERH/ERER/z6vxP9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//0bJ4f8veoj/L3qI/y96iP8veoj/Rsnh/03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j" +
  "//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//03j//9N4///TeP//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const APPLE_TOUCH_ICON_BASE64 =
  "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";

const PNG_32_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAABW0lEQVR42mP4/9iXpohh1ALyLHh40q2jSh+OHp50o7IFR9bb" +
  "CSKBI+vtRi0YtYByCx6fcmss0bW3kpWUEBYSEtRUE48JVtk4z/LvQ2pYEBOsIiEuLIgN2FvJ3jjoTKkF+IG8rOjZ7Q40tEBQ" +
  "UFBdVfz1JQ8qWKCuKl6SodVSrhfopSgkhCJVnK5FqQVRgcpfbnrB1exZYSMliYgYCQnhj9c9ybcA6HZk0yFocosRsppti63J" +
  "t6AkA0sIvL7ogaxmQqMh+Ra0lOthKvv9wAdZTWe1PvkWBHopYio7sdkeWc2CflPyLRASEtyzwgZZzc97Pj6uCshqLu9xoigV" +
  "SUkKT24xen3R4/cDnxOb7dFMtzKVpmFGExQU3LrQioYW5KdoUlRUiIsJ4Tf9z0MfiizYMNeyOF1LQgK9QLUylcYVMuS0iz5e" +
  "99y22HpCo2Fntf6CflOsaWa06TgYLQAAy+Pd3ozIe3cAAAAASUVORK5CYII=";

// Workers runtime has no Buffer; decode via atob.
function bytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const faviconIco = bytes(ICO_BASE64);
export const appleTouchIcon = bytes(APPLE_TOUCH_ICON_BASE64);
export const favicon32Png = bytes(PNG_32_BASE64);
