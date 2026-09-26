# Naru

**Un pequeño compañero para compartir gastos y pagar conversando.**

<p align="center">
  <img src="app/public/naru.png" alt="Naru azul" width="120" />
  <img src="app/public/naru-red.png" alt="Naru rojo" width="120" />
  <img src="app/public/naru-yellow.png" alt="Naru amarillo" width="120" />
</p>

[Explorar la interfaz](https://naru-app-kappa.vercel.app) ·
[Animación azul (MP4)](app/public/naru-idle.mp4) ·
[Animación roja (MP4)](app/public/naru-rojo-idle.mp4)

## ¿Qué problema resuelve?

Dividir una cena entre amigos implica coordinar mensajes, calcular cuánto debe
cada persona y comprobar quién pagó. En cripto, además, hay que configurar una
billetera.

Naru reúne esa experiencia en una conversación con un pajarito personalizable.
Puedes consultar tu saldo, enviar dinero y dividir gastos con amigos. La IA
prepara la acción; tú revisas los detalles y autorizas el pago con una **passkey**
(huella, rostro o PIN del dispositivo).

## Recorrido para el jurado

1. **Crea tu Naru:** elige nombre y color, y regístrate para guardarlo.
2. **Activa los pagos:** crea una passkey y usa **Account → Add test XLM** para
   recibir 5 XLM de prueba.
3. **Conecta con un amigo:** en **People**, elige tu nombre de usuario, busca el
   suyo y envía una invitación. La otra persona debe aceptarla.
4. **Conversa:** pregunta «¿Cuál es mi saldo?» o pide «Divide 3 XLM de la cena
   entre @ana y yo», seleccionando al amigo desde el menú de `@`. Revisa la
   tarjeta y envía las solicitudes.
5. **Completa el pago:** el amigo abre su solicitud, revisa el importe y confirma
   con su passkey. El estado se actualiza y la transacción se puede consultar en
   el explorador de Stellar.

Para probar ambos lados, usa dos cuentas en perfiles de navegador distintos.

**Prototipo en Stellar Testnet:** usa XLM de prueba. La demo alojada permite
explorar la interfaz; para probar los pagos, sigue la instalación local con
SQLite. Los videos muestran las animaciones del compañero.

## ¿Cómo funciona y por qué Stellar?

Stellar registra las transferencias entre cuentas inteligentes, con autorización
mediante passkeys y comisiones cubiertas por Naru. Cada pago deja una transacción
verificable en la red.

- **Next.js, React y Tailwind CSS:** interfaz y servidor.
- **Clerk y Convex:** acceso, amigos, conversaciones y solicitudes en tiempo real.
- **AI SDK + Vercel AI Gateway:** interpretación de mensajes y propuestas de acción.
- **Stellar Smart Account Kit y Soroban:** cuentas y pagos con passkeys.
- **SQLite:** registro persistente del procesamiento de transacciones.

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
`NARU_SMART_ACCOUNT_RP_ID` (`localhost`). SQLite se crea en
`app/.naru-smart-account.sqlite`.

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

---

[Licencia Apache-2.0](LICENSE). Basado en
[Stellar Scaffold](https://github.com/stellar-scaffold/cli) y
[Stellar Smart Account Kit](https://github.com/stellar/smart-account-kit).
