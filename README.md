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

La demo alojada permite explorar la interfaz; para probar los pagos, sigue la
instalación local con SQLite.

## Tecnología

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
