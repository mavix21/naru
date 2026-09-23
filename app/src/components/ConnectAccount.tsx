import { stellarNetwork } from "@stellar-scaffold/app-lib/env";

import FundAccountButton from "./FundAccountButton";
import NetworkPill from "./NetworkPill";
import { WalletButton } from "./WalletButton";

const ConnectAccount = () => {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NetworkPill />
      {stellarNetwork !== "PUBLIC" && <FundAccountButton />}
      <WalletButton />
    </div>
  );
};

export default ConnectAccount;
