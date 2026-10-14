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
[Video pitch](https://youtu.be/LZcUUsZMmSU)

**Para el jurado:** [Funciones](#funciones-disponibles) ·
[Recorrido](#prototipo-recorrido-para-el-jurado) ·
[Transacciones](#evidencia-en-testnet) ·
[Contratos](#contratos-y-código-verificable)

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
XLM/USDC, swaps XLM → USDC, publicación y pago de reembolsos con
[NaruSplit](contracts/naru-split/README.md), y propinas USDC desde wallets externas.
Los agentes preparan las acciones; el usuario revisa y autoriza. El patrocinio
aplica a las operaciones con passkey; **quien envía una propina paga su comisión**.

## Funciones disponibles

| Función                | Qué puede revisar el jurado                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Compañero con IA**   | Nombre y color personalizables; conversación persistente que prepara tarjetas de acción, sin firmar ni gastar por el usuario.                                                  |
| **Cuenta con passkey** | Dirección copiable, saldos XLM/USDC y recargas de **1.000 XLM de prueba** desde Account o pidiéndolas en el chat.                                                              |
| **Swaps y envíos**     | XLM → USDC por monto a gastar **o USDC a recibir**; envíos XLM/USDC a amigos seleccionados con `@`. Si falta USDC, swap y envío se autorizan por separado.                     |
| **Amigos y mensajes**  | Invitaciones, DMs con búsqueda y no leídos, notificaciones de solicitudes y pagos; el chat privado con Naru no se comparte.                                                    |
| **Gastos compartidos** | Splits XLM con solicitudes y respuestas revisables; reembolsos USDC para **2–13 personas**, publicados en Soroban y pagables desde el DM con passkey.                          |
| **Perfil y propinas**  | Página pública `/@username`, nombre, bio, enlace y QR. Invitados pueden enviar **0,1–500 USDC** con una wallet Stellar, sin cuenta Naru ni amistad.                            |
| **Metas de apoyo**     | Una meta pública en USDC, creada en el perfil o redactada con IA y publicada tras confirmación. Solo propinas confirmadas cuentan para el progreso; permite editar y archivar. |

**Alcance:** todo es dinero de prueba. Las metas son registros en Convex, **no
escrow**: las propinas llegan directamente al destinatario, sin bloquear fondos
ni prometer reembolsos. El título y objetivo se fijan tras la primera contribución.
La cancelación USDC existe en el contrato, pero aún no en la interfaz. Cobros por
servicios, tareas remuneradas y pagos programados siguen siendo visión de producto.

## Prototipo: recorrido para el jurado

1. **Crea tu Naru:** elige nombre y color, y regístrate para guardarlo.
2. **Activa los pagos:** crea una passkey y usa **Account → Wallet → Get 1,000 test XLM**
   (o pide «Dame XLM de prueba») para recibir 1.000 XLM de prueba.
3. **Conecta con otra persona:** confirma tu username; en **People**,
   busca el suyo y envía una invitación. La otra persona debe aceptarla.
4. **Conversa:** consulta tu saldo, pide «Cambia 1 XLM por USDC» o
   «Envía 1 USDC a @ana». Selecciona a la persona desde el menú de `@`.
5. **Autoriza:** revisa la tarjeta y confirma con tu passkey. El recibo enlaza
   la transacción confirmada en Stellar.
6. **Divide un gasto:** con dos amigos activados, pide «I paid 12 USDC; split it
   between @ana, @josh, and me». Revisa las partes y pulsa **Publish requests with
   passkey**. Cada amigo recibe una solicitud de 4 USDC en su DM. Publicar no
   transfiere fondos. En el DM, cada amigo pulsa **Pay my share**, revisa y
   autoriza con su propia passkey; el pago va directamente al organizador y la
   tarjeta muestra el recibo. Si falta USDC, usa **Get USDC** y vuelve tras el swap.

Para probar ambos lados, usa cuentas en perfiles de navegador distintos.

**También puedes revisar sin añadir amigos:**

- **Perfil y meta:** abre **Account → Edit profile**, edita la bio y publica un
  **Support goal**, o pide «Ayúdame a crear una meta de 100 USDC para mi proyecto»
  y confirma la tarjeta. Comparte `/@tu_username` con su enlace o QR.
- **Propina de un invitado:** abre ese perfil sin sesión Naru, conecta una wallet
  como Freighter en **Testnet**, con USDC oficial y XLM para la comisión, y envía
  una propina. Si falta la trustline, el checkout ofrece añadirla; esto **no compra
  USDC**. Revisa destinatario, monto y comisión antes de firmar en la wallet.
- **Seguimiento:** comprueba el recibo en Stellar, la notificación del
  destinatario y el progreso de la meta. Recargar la página recupera una propina
  pendiente sin crear un segundo pago.

### Evidencia en Testnet

Validaciones del **4–5 de octubre de 2026**, mediante la app y passkeys virtuales
de Chromium con autorización verificada en cadena:

| Flujo                    | Resultado                                                                            | Recibo                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Swap                     | 1 XLM → 0,1057259 USDC                                                               | [`173a183f…11e361ff`](https://stellar.expert/explorer/testnet/tx/173a183f11ed5d7ea05babcacf096c6738111aff717dd0a7249045ad11e361ff) |
| Transferencia            | 1 USDC entre amigos                                                                  | [`bbd304a7…c09f88ea`](https://stellar.expert/explorer/testnet/tx/bbd304a78c00956c79a9706f2f3f2e00b0bbdcd7130c18216841b8f5c09f88ea) |
| Publicación de reembolso | 12 USDC entre tres personas; dos solicitudes por DM; comisión real **0,1846935 XLM** | [`65bc68f1…c1e18a93`](https://stellar.expert/explorer/testnet/tx/65bc68f184aea68be781a3bc1aad8e6137e140bd6d3c64d0bc3999a6c1e18a93) |

Los reintentos conservan el mismo hash y evitan duplicar operaciones o mensajes.
Los detalles del contrato, costes y mantenimiento están en el
[README de NaruSplit](contracts/naru-split/README.md).

Estos recibos documentan los flujos de esa fecha, **no el pago posterior de las
partes ni las propinas/metas añadidas después**. Para esos flujos, la app genera
el recibo al confirmar. Testnet puede reiniciarse y el historial RPC caduca;
los hashes completos y ledgers de NaruSplit están en el
[registro de despliegue](contracts/naru-split/deployments/testnet.json).

### Contratos y código verificable

**NaruSplit v0.2.0 · Stellar Testnet** — contrato propio para reembolsos USDC:

[`CCGF3HL4GCL37O2ZCCU6ZJRU5EEUGFRMZEV46BHKF5767ZYPY4BM6R76`](https://stellar.expert/explorer/testnet/contract/CCGF3HL4GCL37O2ZCCU6ZJRU5EEUGFRMZEV46BHKF5767ZYPY4BM6R76)

| Evidencia            | Referencia                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WASM SHA-256         | `ea4d32725fdfe63004095990dbe05ab13f84b24328891a04412f256a9b2fe0d8`                                                                                                                       |
| Upload del WASM      | [`0af4f877…4466e694`](https://stellar.expert/explorer/testnet/tx/0af4f8772e7a453e740c30cce3bf13759a34a2d61a9fd15dbed573bc4466e694)                                                       |
| Despliegue           | [`365eee5d…2b7f96dd`](https://stellar.expert/explorer/testnet/tx/365eee5d8e8bb9262afb43edda666e3de3add7b7aa6db6c188b1ea912b7f96dd)                                                       |
| Código y verificador | [Rust](contracts/naru-split/src/lib.rs) · [Verificación read-only](contracts/naru-split/scripts/verify-testnet.mjs) · [Registro completo](contracts/naru-split/deployments/testnet.json) |

`create` registra términos sin mover fondos; `pay` transfiere una parte al
organizador con autorización del participante y evita cobrarla dos veces.
Importes enteros con 7 decimales y redondeo determinista conservan el total.
Nombres, descripciones y conversaciones permanecen fuera de cadena.

<details>
<summary>Contratos de integración y activos fijados en Testnet</summary>

| Integración                           | Dirección verificable                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| USDC oficial · Stellar Asset Contract | [`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| Emisor USDC                           | [`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`](https://stellar.expert/explorer/testnet/account/GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5)  |
| Soroswap router                       | [`CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD`](https://stellar.expert/explorer/testnet/contract/CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD) |
| Verificador WebAuthn                  | [`CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F`](https://stellar.expert/explorer/testnet/contract/CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F) |

Cada usuario tiene su propia cuenta inteligente: **Account → Wallet** muestra
su dirección. Los hashes WASM de cuenta/verificador están en
[`smart-account/shared.ts`](app/src/lib/smart-account/shared.ts); router,
factory y pool en [`swaps/shared.ts`](app/src/lib/swaps/shared.ts); activos y
NaruSplit en [`money.ts`](backend/convex/money.ts).

</details>

## Tecnología

- **Next.js, React y Tailwind CSS:** interfaz y servidor.
- **Clerk y Convex:** acceso, amigos, conversaciones y estado persistente de pagos.
- **AI SDK + Vercel AI Gateway:** interpretación de mensajes y propuestas de acción.
- **Stellar Smart Account Kit y Soroban:** cuentas y pagos con passkeys.
- **Soroswap:** swaps XLM → USDC con cotizaciones verificadas en Testnet.
- **Stellar Wallets Kit:** conexión y firma de wallets externas para propinas.

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

Cada username de Naru tiene automáticamente un perfil accesible sin sesión en
`/@username`. **Account → Edit profile** permite editar el nombre humano, la bio
y la meta de apoyo; **View public profile** abre la página para compartir URL o
QR y recibir propinas si los pagos están activados. El nombre del compañero sigue
en **Companion**.
Las cuentas existentes sin username conservan chats y pagos; el recordatorio
persistente lleva a `/username`.

Para añadir WalletConnect al checkout público, configura la variable opcional
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` con un proyecto de Reown. Las wallets de
extensión/web no necesitan esa variable.

<details>
<summary>Configuración de Clerk y validación del despliegue</summary>

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

</details>

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
