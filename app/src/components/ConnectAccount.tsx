import { stellarNetwork } from "@stellar-scaffold/app-lib/env"
import FundAccountButton from "./FundAccountButton"
import NetworkPill from "./NetworkPill"
import { WalletButton } from "./WalletButton"

const ConnectAccount = () => {
	return (
		<div className="connect-account">
			<NetworkPill />
			{stellarNetwork !== "PUBLIC" && <FundAccountButton />}
			<WalletButton />
		</div>
	)
}

export default ConnectAccount
