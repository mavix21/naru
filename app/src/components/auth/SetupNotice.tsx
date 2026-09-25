import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SetupNotice() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Authentication setup required</CardTitle>
        <CardDescription>
          Configure the Clerk development instance and Convex deployment, then
          restart the app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <p>
            Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (pk_test_…), CLERK_SECRET_KEY
            (sk_test_…), and NEXT_PUBLIC_CONVEX_URL in the app environment.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
