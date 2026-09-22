import { labPrefix } from "@stellar-scaffold/app-lib/env"
import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import "@stellar-scaffold/app-lib/styles.css"
import "../providers/NotificationProvider.css"
import styles from "../App.module.css"
import ConnectAccount from "../components/ConnectAccount"
import Providers from "./providers"

export const metadata: Metadata = {
	title: "Scaffold Stellar",
	description: "Build dApps on the Stellar network",
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body>
				<Providers>
					<div className={styles.AppLayout}>
						<header className={styles.header}>
							<Link className={styles.logo} href="/">
								Scaffold
							</Link>
							<nav className={styles.headerNav}>
								<Link href="/debug">Contract Explorer</Link>
								<a href={labPrefix()} target="_blank" rel="noreferrer">
									Transaction Explorer
								</a>
							</nav>
							<ConnectAccount />
						</header>
						<main className={styles.main}>{children}</main>
						<footer className={styles.footer}>
							<nav className={styles.footerNav}>
								<a href="https://github.com/stellar-scaffold/cli" target="_blank" rel="noreferrer">
									GitHub
								</a>
								<a
									href="https://www.youtube.com/watch?v=0syGaIn3ULk&list=PLmr3tp_7-7Gjj6gn5-bBn-QTMyaWzwOU5"
									target="_blank"
									rel="noreferrer"
								>
									Tutorial
								</a>
								<a href="https://scaffoldstellar.org" target="_blank" rel="noreferrer">
									View docs
								</a>
							</nav>
						</footer>
					</div>
				</Providers>
			</body>
		</html>
	)
}
