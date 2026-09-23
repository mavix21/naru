import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

export default function Debug() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract Explorer</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p>
            The Contract Explorer is being converted to a standalone Stellar
            Scaffold Extension that runs in its own process. Once available,
            this page will link to it automatically.
          </p>
          <p>
            In the meantime, use the{" "}
            <a
              className="text-primary underline"
              href="https://lab.stellar.org"
              target="_blank"
              rel="noreferrer"
            >
              Stellar Lab
            </a>{" "}
            to inspect transactions.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
