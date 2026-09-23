import { labPrefix } from "@stellar-scaffold/app-lib/env";
import Link from "next/link";

import { GuessTheNumber } from "../components/GuessTheNumber";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

const Home = () => (
  <div className="mx-auto max-w-4xl space-y-8">
    <section className="mx-auto max-w-xl space-y-4 py-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        Yay! You&apos;re on Stellar!
      </h1>
      <p className="text-muted-foreground">
        A local development template designed to help you build dApps on the
        Stellar network. Test wallet connections, smart contract interactions,
        and transaction verifications.
      </p>
      <Button
        variant="outline"
        render={
          <a
            aria-label="View docs"
            href="https://scaffoldstellar.org/docs/intro"
            target="_blank"
            rel="noreferrer"
          />
        }
      >
        View docs
      </Button>
    </section>

    <Card>
      <CardHeader>
        <CardTitle>Sample Contracts</CardTitle>
        <CardDescription>
          <strong>Guess The Number:</strong> Interact with the sample contract
          from the{" "}
          <a
            className="text-primary underline"
            href="https://scaffoldstellar.org/docs/tutorial/overview"
            target="_blank"
            rel="noreferrer"
          >
            Scaffold Tutorial
          </a>{" "}
          using an automatically generated contract client.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <GuessTheNumber />
          <p>Or take a look at other sample contracts to get you started:</p>
          <nav className="flex flex-wrap gap-2" aria-label="Sample contracts">
            <Button
              variant="outline"
              render={
                <a
                  aria-label="OpenZeppelin sample contracts"
                  href="https://github.com/OpenZeppelin/stellar-contracts/tree/main/examples"
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              OpenZeppelin sample contracts
            </Button>
            <Button
              variant="outline"
              render={
                <a
                  aria-label="Soroban sample contracts"
                  href="https://github.com/stellar/soroban-examples"
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              Soroban sample contracts
            </Button>
          </nav>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Start Building</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <ol className="list-inside list-decimal space-y-2">
            <li>
              Add your contract under <code>/src/contracts</code>
            </li>
            <li>
              Contracts are built by Scaffold when you run{" "}
              <code>npm start</code>
            </li>
            <li>
              Changes are rebuilt automatically by <code>Next.js</code>
            </li>
            <li>
              Interact with your contract immediately in the Contract Explorer
            </li>
          </ol>
          <p className="space-x-2">
            <a
              className="text-primary underline"
              href="https://www.youtube.com/watch?v=86hWe8Ragtg&list=PLmr3tp_7-7Gjj6gn5-bBn-QTMyaWzwOU5&index=1"
            >
              Youtube tutorial
            </a>
            <a
              className="text-primary underline"
              href="https://scaffoldstellar.org/showcase"
            >
              Example frontends
            </a>
            <a
              className="text-primary underline"
              href="https://developers.stellar.org/docs/tools/cli/install-cli"
            >
              Mainnet deployment guide
            </a>
          </p>
        </div>
      </CardContent>
    </Card>

    <section className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardContent>
          Invoke your smart contract using the{" "}
          <Link className="text-primary underline" href="/debug">
            Contract Explorer
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          Browse your local transactions with the{" "}
          <a className="text-primary underline" href={labPrefix()}>
            Transaction Explorer
          </a>
        </CardContent>
      </Card>
    </section>
  </div>
);

export default Home;
