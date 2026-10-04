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

**Stellar es la infraestructura que permite a Naru ejecutar movimientos de dinero
autorizados por el usuario.** La aplicación integra cuentas inteligentes
(smart accounts) en Soroban controladas mediante **passkeys** (huella, rostro o
PIN del dispositivo), sin exigir conectar una wallet externa ni gestionar una
frase semilla. La plataforma patrocina las comisiones de red para que el usuario
pueda concentrarse en la acción que quiere realizar.

Los agentes preparan y coordinan las operaciones; el usuario autoriza el
movimiento y Stellar registra su ejecución. La confirmación de la transacción
permite actualizar el estado del pago en las conversaciones de los participantes.

Esta infraestructura sirve como base para ampliar Naru hacia cobros por
servicios, tareas remuneradas y acuerdos de pago programables entre usuarios y
sus agentes. **El prototipo actual valida la creación de cuentas, el fondeo y
las transferencias en Stellar Testnet con activos de prueba; las capacidades
adicionales forman parte de la visión del producto.**

## Prototipo: recorrido para el jurado

1. **Crea tu Naru:** elige nombre y color, y regístrate para guardarlo.
2. **Activa los pagos:** crea una passkey y usa **Account → Add test XLM** para
   recibir 5 XLM de prueba.
3. **Conecta con otra persona:** en **People**, elige tu nombre de usuario,
   busca el suyo y envía una invitación. La otra persona debe aceptarla.
4. **Conversa:** consulta tu saldo, pide «Envía 1 XLM a @ana» o prepara un gasto
   compartido. Selecciona a la persona desde el menú de `@`.
5. **Autoriza y sigue el resultado:** revisa la tarjeta y confirma el pago con
   tu passkey. El estado se actualiza y puedes consultar la transacción en el
   explorador de Stellar. Las solicitudes de gastos compartidos llegan al otro
   participante para que pueda responder o pagar.

Para probar ambos lados, usa dos cuentas en perfiles de navegador distintos.

Los pagos usan Stellar Testnet y guardan su estado en Convex, tanto en local
como en Vercel.

## Tecnología

- **Next.js, React y Tailwind CSS:** interfaz y servidor.
- **Clerk y Convex:** acceso, amigos, conversaciones, solicitudes y registro
  persistente de transacciones, reservas del patrocinador y límites de uso.
- **AI SDK + Vercel AI Gateway:** interpretación de mensajes y propuestas de acción.
- **Stellar Smart Account Kit y Soroban:** cuentas y pagos con passkeys.

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

En el dashboard de **Convex → Settings → Environment Variables**, configura
`NARU_PAYMENTS_KEY` con el mismo valor y `CLERK_JWT_ISSUER_DOMAIN` con la URL de
Clerk `https://tu-instancia.clerk.accounts.dev`, sin barra final.

Puedes crear las dos cuentas Testnet y financiarlas con Friendbot desde
[Stellar Lab](https://lab.stellar.org). Conserva los valores locales de
`NARU_SMART_ACCOUNT_ORIGIN` (`http://localhost:3000`) y
`NARU_SMART_ACCOUNT_RP_ID` (`localhost`). El estado de los pagos se guarda en
el mismo backend de Convex configurado en `NEXT_PUBLIC_CONVEX_URL`.

Más opciones en [app/.env.example](app/.env.example) y
[backend/.env.example](backend/.env.example).

</details>

### 3. Inicia la aplicación

```bash
# Terminal 1, desde la raíz del repositorio
pnpm --dir backend dev

# Terminal 2, desde la raíz del repositorio
pnpm --dir app dev
```

Abre **http://localhost:3000** con un navegador compatible con passkeys. Los pagos
usan Testnet y el backend de Convex está en la nube.

Para desarrollar también los contratos del workspace, instala Rust, Stellar CLI
y Stellar Scaffold CLI, inicia Docker y usa `pnpm dev` desde la raíz.
Comprobaciones disponibles: `pnpm lint`, `pnpm typecheck` y `pnpm build`.

### Swaps XLM → USDC en Testnet

1. Obtén una clave en [Soroswap API](https://api.soroswap.finance/login) y añade
   `NARU_SOROSWAP_API_KEY` a `app/.env.local` (o a las variables de Vercel).
   Es una credencial **solo de servidor**. Configura el perfil de partner sin
   comisión adicional: las cotizaciones con partner fee se rechazan.
2. Publica el esquema y las funciones actualizadas con
   `pnpm --dir backend exec convex dev --once`. Se reutilizan Clerk, Convex,
   la cuenta inteligente, su passkey y el patrocinador ya configurados.
3. Ejecuta `pnpm --dir app swaps:check`: verifica red, contratos, identidad de
   los activos, reservas del pool y una cotización real para 1 XLM. Es una
   comprobación de lectura; no envía transacciones. Si usas otro archivo de
   entorno, exporta sus variables antes de ejecutar el comando.
4. En el chat pide «Cambia 1 XLM por USDC». Revisa la estimación, el mínimo,
   los costes y la caducidad. **Confirm with passkey** autoriza esa cotización.
   Una cotización caducada requiere **Get new quote** y otra confirmación.
5. Espera **Swapped · confirmed**, abre el recibo en Stellar Expert y comprueba
   los saldos XLM/USDC en Account. Un hash pendiente no significa éxito.

Se usa USDC oficial de Testnet, con 7 decimales:

- Emisor: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
- Contrato: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
- XLM: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`.

La identidad se deriva usando la passphrase Testnet y se verifica en cadena.
No se usa el token distinto etiquetado como USDC en el quickstart de Soroswap.
Las identidades oficiales se documentan en
[Stellar Docs](https://developers.stellar.org/docs/build/agentic-payments/x402#testnet-usdc).
Los contratos y hashes permitidos están en `app/src/lib/swaps/shared.ts`,
contrastados con el [deployment de Soroswap](https://github.com/soroswap/core/blob/main/public/testnet.contracts.json).
Un reset de Testnet o un cambio de código pausa los swaps hasta revisar esas
identidades; no se aceptan contratos nuevos automáticamente.

El servidor solicita `/quote?network=testnet` con `protocols: ["soroswap"]`,
una ruta directa y 50 bps de tolerancia (0,5%). Si el API responde exactamente
**No path found**, verifica nuevamente el pool y consulta
`router_get_amounts_out` en el router Soroswap desplegado. Esta cotización
proviene de la cadena en vivo; su ledger y origen quedan guardados, y la
tarjeta la identifica como **Soroswap · live on-chain quote**. Errores de
credenciales, respuestas inválidas y rutas no permitidas se rechazan.
Construye la llamada al router
verificado a partir de la cotización, sin confiar en XDR externo ni abrir una
wallet externa. La comisión del pool (0,3%) está incluida; Naru patrocina la
red con un máximo de 0,5 XLM. Solo se autoriza el router y una transferencia
exacta de XLM al pool verificado. El destino de USDC es la propia cuenta.
La expiración de dos minutos también limita la transacción y el contrato.

Pruebas enfocadas: `pnpm --dir app test` y `pnpm --dir backend test`.
Cubren importes enteros, activos/rutas incorrectos, árboles de autorización
alterados, caducidad, cambio de cotización, aislamiento por usuario y
reservas idempotentes. Las fixtures de prueba nunca generan cotizaciones
en la aplicación. No se sustituye USDC ni se inventa una cotización: el
fallback consulta el contrato Soroswap verificado. Una passkey rechazada no envía el swap;
una transacción pendiente se reconcilia por su mismo hash, sin repetirla.

**Validación end-to-end del 4 de octubre de 2026:** se confirmó un swap real
de **1 XLM → 0,1057259 USDC**, mínimo **0,1051973 USDC**, en el ledger
**5013745**. Se recorrió el chat, la tarjeta, autorización WebAuthn virtual en
Chromium, envío patrocinado y recibo; los saldos pasaron de 5 a 4 XLM y de
0 a 0,1057259 USDC en una cuenta de prueba aislada. Una consulta RPC
independiente verificó `SUCCESS`.

[Transacción confirmada: 173a183f11ed5d7ea05babcacf096c6738111aff717dd0a7249045ad11e361ff](https://stellar.expert/explorer/testnet/tx/173a183f11ed5d7ea05babcacf096c6738111aff717dd0a7249045ad11e361ff).

El script reproducible confirmó una segunda ejecución en el ledger **5013837**:
[9a2b45593c0f594e10dbc758ba20727d016a7f6ed10bb95d60a217b9ea9afb4c](https://stellar.expert/explorer/testnet/tx/9a2b45593c0f594e10dbc758ba20727d016a7f6ed10bb95d60a217b9ea9afb4c).
Reenviar la misma autorización devolvió el mismo recibo sin cambiar los saldos;
se verificó la prevención de ejecución duplicada en la ruta autenticada real.

El API no encontraba la ruta porque su lista de pools Testnet estaba vacía;
se utilizó el fallback on-chain explícito con los mismos activos oficiales.
También se validaron el matcher de Clerk para `/api/swaps` y los dos contextos
de autorización del swap (router + transferencia XLM), ambos con la regla
de passkey existente.

Para repetir la prueba real, inicia `pnpm --dir app dev`, instala Chromium con
`pnpm --dir app exec playwright install chromium` y ejecuta
`NARU_SWAP_E2E_DIR=/ruta/privada/fuera/del/repo pnpm --dir app test:swap:e2e`.
El script usa Clerk Development y localhost, crea o reutiliza una cuenta de
prueba, y ejecuta un swap de 1 XLM con una passkey virtual. Guarda capturas y
el estado privado del navegador/passkey en ese directorio; no lo publiques.

## Desplegar en Vercel

1. Configura las variables de `app/.env.example` en Vercel. Usa
   `NARU_SMART_ACCOUNT_ENABLED=true`, `NARU_SMART_ACCOUNT_ORIGIN=https://tu-dominio`
   y `NARU_SMART_ACCOUNT_RP_ID=tu-dominio`, el dominio estable donde usarás passkeys.
2. En el deployment de Convex elegido, configura `CLERK_JWT_ISSUER_DOMAIN` y
   el mismo `NARU_PAYMENTS_KEY` de Vercel. Cada deployment independiente de Convex
   debe usar su propia cuenta patrocinadora para coordinar su secuencia.
3. Despliega las funciones y el esquema de Convex antes de publicar la app.
   Para hacerlo en cada build, configura `CONVEX_DEPLOY_KEY` en Vercel, selecciona
   `app` como Root Directory y usa este Build Command:

   ```bash
   pnpm --dir ../backend exec convex deploy --cmd 'pnpm --dir ../app build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
   ```

   La clave debe corresponder al backend que usará la app. El comando inyecta su
   URL en el build. Activa el acceso a los archivos fuera del Root Directory
   para incluir los paquetes del workspace.

---

[Licencia Apache-2.0](LICENSE). Basado en
[Stellar Scaffold](https://github.com/stellar-scaffold/cli) y
[Stellar Smart Account Kit](https://github.com/stellar/smart-account-kit).
