# Naru

**Naru es tu compañero financiero con IA: un agente personalizable diseñado para
ayudarte a ganar, mover y organizar tu dinero, y coordinarse con los Narus de
otras personas.**

<p align="center">
  <img src="app/public/naru.png" alt="Naru azul" width="120" />
  <img src="app/public/naru-red.png" alt="Naru rojo" width="120" />
  <img src="app/public/naru-yellow.png" alt="Naru amarillo" width="120" />
</p>

[Explorar la interfaz](https://naru-app-kappa.vercel.app) ·
[Video pitch](https://youtu.be/3jpPjH41-b4?si=T9mQOICz7EKsTd2F) ·
[Video demo](https://youtu.be/T3Sl3tSe1pg?si=eWVtPePxf22GjoBg)

## ¿Qué problema resuelve?

Las personas piensan en objetivos: cobrar por su trabajo, organizar sus gastos,
ahorrar para algo importante o encontrar nuevas formas de generar ingresos.
Convertir esos objetivos en resultados exige navegar entre aplicaciones, hacer
cálculos, coordinar con otras personas y dar seguimiento manualmente. Esa carga
consume tiempo y deja oportunidades, pagos y decisiones pendientes.

**Naru busca que cualquier persona pueda delegar gestiones financieras en un
compañero que conozca su contexto y pueda actuar con su autorización.** Desde una
conversación, el usuario expresa lo que necesita; Naru prepara las acciones,
solicita las confirmaciones necesarias y mantiene el seguimiento. Su identidad
personalizable hace que esa relación tenga continuidad y resulte cercana,
incluso para quienes nunca han utilizado un agente o una wallet.

La dimensión social amplía esa propuesta: tu Naru puede comunicarse con los de
otras personas para coordinar pagos, llevar solicitudes y gestionar acuerdos,
sin exponer conversaciones privadas ni decidir por sus usuarios. Enviar dinero
y dividir gastos son los primeros casos de uso de una visión más amplia:
**un compañero que te ayude a conseguir ingresos, administrar lo que recibes y
cumplir objetivos con tu dinero.**

## ¿Cómo usa Stellar?

**Stellar permite a Naru ejecutar movimientos de dinero autorizados por el
usuario.** Las cuentas inteligentes en Soroban usan **passkeys** (huella, rostro
o PIN), sin conectar una wallet externa ni gestionar una frase semilla. Naru
patrocina las comisiones de red con un límite de **0,5 XLM por transacción**.

El prototipo usa **Stellar Testnet**: activación de cuentas, fondeo, transferencias
XLM/USDC, swaps XLM → USDC y publicación de reembolsos con
[NaruSplit](contracts/naru-split/README.md). Los agentes preparan las acciones;
el usuario revisa y autoriza. Cobros por servicios, tareas remuneradas y otros
acuerdos programables forman parte de la visión del producto.

## Prototipo: recorrido para el jurado

1. **Crea tu Naru:** elige nombre y color, y regístrate para guardarlo.
2. **Activa los pagos:** crea una passkey y usa **Account → Add test XLM** para
   recibir 5 XLM de prueba.
3. **Conecta con otra persona:** en **People**, elige tu nombre de usuario,
   busca el suyo y envía una invitación. La otra persona debe aceptarla.
4. **Conversa:** consulta tu saldo, pide «Cambia 1 XLM por USDC» o
   «Envía 1 USDC a @ana». Selecciona a la persona desde el menú de `@`.
5. **Autoriza:** revisa la tarjeta y confirma con tu passkey. El recibo enlaza
   la transacción confirmada en Stellar.
6. **Divide un gasto:** con dos amigos activados, pide «I paid 12 USDC; split it
   between @ana, @josh, and me». Revisa las partes y pulsa **Publish requests with
   passkey**. Cada amigo recibe una solicitud de 4 USDC en su DM. Publicar no
   transfiere fondos; estas tarjetas USDC son de solo lectura por ahora.

Para probar ambos lados, usa cuentas en perfiles de navegador distintos.

### Evidencia en Testnet

Validaciones del **4–5 de octubre de 2026**, mediante la app y passkeys virtuales
de Chromium con autorización verificada en cadena:

| Flujo         | Resultado                                           | Recibo                                                                                                                         |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Swap          | 1 XLM → 0,1057259 USDC                              | [Ver transacción](https://stellar.expert/explorer/testnet/tx/173a183f11ed5d7ea05babcacf096c6738111aff717dd0a7249045ad11e361ff) |
| Transferencia | 1 USDC entre amigos                                 | [Ver transacción](https://stellar.expert/explorer/testnet/tx/bbd304a78c00956c79a9706f2f3f2e00b0bbdcd7130c18216841b8f5c09f88ea) |
| Reembolso     | 12 USDC entre tres personas; dos solicitudes por DM | [Ver transacción](https://stellar.expert/explorer/testnet/tx/65bc68f184aea68be781a3bc1aad8e6137e140bd6d3c64d0bc3999a6c1e18a93) |

Los reintentos conservan el mismo hash y evitan duplicar operaciones o mensajes.
Los detalles del contrato, costes y mantenimiento están en el
[README de NaruSplit](contracts/naru-split/README.md).

## Tecnología

- **Next.js, React y Tailwind CSS:** interfaz y servidor.
- **Clerk y Convex:** acceso, amigos, conversaciones y estado persistente de pagos.
- **AI SDK + Vercel AI Gateway:** interpretación de mensajes y propuestas de acción.
- **Stellar Smart Account Kit y Soroban:** cuentas y pagos con passkeys.
- **Soroswap:** swaps XLM → USDC con cotizaciones verificadas en Testnet.

## Ejecutar en local

Necesitas **Node.js 24+**, **pnpm 11.25.0**, cuentas de desarrollo en **Clerk** y
**Convex**, y una clave de **Vercel AI Gateway** para el chat.

### 1. Instala y conecta el backend

```bash
git clone https://github.com/mavix21/naru.git
cd naru
pnpm install
cp -n app/.env.example app/.env.local
pnpm --dir backend exec convex dev --configure --dev-deployment cloud --once --skip-push
```

Elige un proyecto de desarrollo en la nube. La CLI genera `backend/.env.local`.

### 2. Configura los servicios

<details>
<summary>Variables necesarias para probar el flujo completo</summary>

En Clerk, crea una aplicación **Development** y activa la
[integración con Convex](https://docs.convex.dev/auth/clerk).
Completa `app/.env.local` con:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` y `CLERK_SECRET_KEY`: claves `pk_test_…` y
  `sk_test_…` de la misma aplicación Clerk.
- `NEXT_PUBLIC_CONVEX_URL`: URL `https://….convex.cloud` del backend elegido.
- `AI_GATEWAY_API_KEY`: clave de Vercel AI Gateway.
- `NARU_PAYMENTS_KEY`: secreto aleatorio de al menos 32 caracteres.
- `NARU_SMART_ACCOUNT_SPONSOR_SECRET`: clave `S…` de una cuenta Testnet financiada
  para cubrir comisiones y saldo de prueba.
- `NARU_SMART_ACCOUNT_RECIPIENT`: dirección `G…` de una segunda cuenta Testnet
  financiada, requerida por la configuración.
- `NARU_SOROSWAP_API_KEY`: clave de [Soroswap API](https://api.soroswap.finance/login)
  para los swaps, con un perfil de partner sin comisión adicional.

En **Convex → Settings → Environment Variables**, configura `NARU_PAYMENTS_KEY`
con el mismo valor y `CLERK_JWT_ISSUER_DOMAIN` con la URL de Clerk
`https://tu-instancia.clerk.accounts.dev`, sin barra final.

Puedes crear las cuentas Testnet y financiarlas con Friendbot desde
[Stellar Lab](https://lab.stellar.org). Conserva los valores locales de
`NARU_SMART_ACCOUNT_ORIGIN` (`http://localhost:3000`) y
`NARU_SMART_ACCOUNT_RP_ID` (`localhost`).

Más opciones en [app/.env.example](app/.env.example) y
[backend/.env.example](backend/.env.example).

</details>

### 3. Inicia la aplicación

```bash
pnpm dev
```

Inicia Next.js y Convex juntos. Abre **http://localhost:3000** con un navegador
compatible con passkeys. Para ejecutar solo la interfaz: `pnpm --dir app dev`.
Los contratos ya están desplegados en Testnet; el desarrollo de la app no
requiere Docker ni Stellar Scaffold.

### Swaps y transferencias USDC

`pnpm --dir app swaps:check` comprueba contratos, activos, reservas y una
cotización real sin enviar transacciones. Naru usa el USDC oficial de Testnet
con 7 decimales, una ruta directa en Soroswap y 0,5% de tolerancia. Si el API
devuelve **No path found**, consulta el router verificado en cadena y lo indica
en la tarjeta. Las cotizaciones caducadas requieren revisión y autorización nuevas.

Si falta USDC para una transferencia, **Get USDC with a swap** prepara la
solicitud de cambio. El usuario autoriza el swap y luego el envío por separado.
Las identidades de los activos están en `backend/convex/money.ts`; las del
mercado, en `app/src/lib/swaps/shared.ts`.

### Perfiles públicos y configuración de Clerk

Cada username de Naru tiene automáticamente un perfil anónimo en `/@username`.
**Account → Your public profile** permite editar el nombre humano y la bio, ver
el perfil y compartir su URL o QR. El nombre del compañero sigue en **Companion**.
Las cuentas existentes sin username conservan chats y pagos; el recordatorio
persistente lleva a `/username`.

Configuración **manual** necesaria en cada instancia de Clerk (no aplicada por
el código):

1. **User & authentication → Username**: habilitar username y marcarlo como
   **Required**. Ajustar la longitud a **3–24** y permitir letras, números y
   guion bajo. Naru exige además empezar con una letra, normaliza a minúsculas y
   rechaza nombres reservados en el servidor. Si Clerk acepta un formato más
   amplio, Naru solicita corregirlo antes de completar el onboarding.
2. **SSO connections → Google**: mantener Google habilitado. Los componentes
   prebuilt `SignUp`/`SignIn` recogen los requisitos faltantes después de OAuth;
   no hay un segundo formulario de registro. No exigir username mediante una
   tarea global de sesión que bloquee a usuarios existentes.
3. **User model → User permissions**: desactivar **Allow users to change their
   username**. La finalización usa el Backend API y sigue funcionando con esta
   restricción. El username confirmado de Naru es la autoridad; cambios directos
   posteriores en Clerk se reconcilian hacia ese valor. No se ofrecen renombres.
4. **Webhooks**: registrar `https://tu-dominio/api/webhooks/clerk` para
   `user.created` y `user.updated`, y configurar `CLERK_WEBHOOK_SIGNING_SECRET`
   en la app. Los eventos se verifican y se vuelve a leer el usuario actual para
   resistir entregas duplicadas o desordenadas. Los fallos transitorios devuelven
   503 para reintento; las colisiones requieren corregir el username.
5. Configurar `NARU_PUBLIC_ORIGIN=https://tu-dominio` (sin ruta); si falta, se usa
   `NARU_SMART_ACCOUNT_ORIGIN`. Compartir, metadatos y QR usan exactamente esa URL
   canónica. La sincronización reutiliza el secreto servidor `NARU_PAYMENTS_KEY`
   existente, con el mismo valor en app y Convex; no necesita activar pagos.
6. Desplegar Convex antes de la app. Para importar los usernames de usuarios de
   Clerk anteriores al webhook, ejecutar una vez `pnpm --dir app profiles:sync`.
   Es reintentable: conserva usernames y nombres editados existentes, y reporta
   conflictos sin reasignar handles. Las sesiones también reparan sincronizaciones
   pendientes; una reserva no caduca mientras el resultado de Clerk sea incierto.

Revisado contra **`@clerk/nextjs` 7.9.7**, instalado en este repo, y documentación
oficial del 8 de octubre de 2026:
[opciones de autenticación](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options),
[`SignUp`](https://clerk.com/docs/nextjs/reference/components/authentication/sign-up),
[requisitos OAuth](https://clerk.com/docs/guides/development/custom-flows/authentication/oauth-connections#handle-missing-requirements),
[sincronización](https://clerk.com/docs/guides/development/webhooks/syncing).

Validación manual de despliegue: probar registro nuevo con Google y email,
username faltante/reservado/ocupado, cuenta antigua con chats, reintento tras
interrupción, nombre corregido conservado al volver a entrar, perfil en incógnito,
404 desconocido, compartir/copiar y escanear QR en móvil. Los tests automatizados
de perfiles cubren aislamiento público, autorización, colisiones concurrentes,
reintentos, nombres y compartir; no sustituyen el login real con Google.

### Comprobaciones

```bash
pnpm lint
pnpm typecheck
pnpm --dir app test
pnpm --dir app exec playwright install chromium
pnpm --dir app test:profiles:browser
pnpm --dir backend test
pnpm --dir contracts test
pnpm build
```

Para los comandos de contratos y el build completo, instala el toolchain de
`rust-toolchain.toml`. `pnpm --dir app build` construye solo la aplicación web.

## Desplegar en Vercel

1. Configura las variables de `app/.env.example` en Vercel. Usa
   `NARU_SMART_ACCOUNT_ENABLED=true`, `NARU_SMART_ACCOUNT_ORIGIN=https://tu-dominio`
   y `NARU_SMART_ACCOUNT_RP_ID=tu-dominio`, el dominio estable donde usarás passkeys.
2. En Convex, configura `CLERK_JWT_ISSUER_DOMAIN` y el mismo `NARU_PAYMENTS_KEY`.
   Cada deployment independiente debe usar su propia cuenta patrocinadora.
3. Configura `CONVEX_DEPLOY_KEY` del backend correspondiente en Vercel,
   selecciona `app` como Root Directory y usa este Build Command:

   ```bash
   pnpm --dir ../backend exec convex deploy --cmd 'pnpm --dir ../app build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
   ```

   Activa el acceso a archivos fuera del Root Directory para incluir el backend.
   Programa el [mantenimiento de NaruSplit](contracts/naru-split/README.md#fees-and-persistence).

---

[Licencia Apache-2.0](LICENSE). Basado en
[Stellar Scaffold](https://github.com/stellar-scaffold/cli) y
[Stellar Smart Account Kit](https://github.com/stellar/smart-account-kit).
