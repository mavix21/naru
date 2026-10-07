import Link from "next/link";

import { Button } from "@/components/ui/button";

import { CompanionScene } from "./CompanionScene";
import { Description, Frame, Heading, Scene, SceneCopy } from "./Frame";

export function Welcome() {
  return (
    <Frame
      controls={
        <Button
          render={<Link href="/sign-in" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
        >
          Sign in
        </Button>
      }
    >
      <Scene>
        <CompanionScene name="Naru" accent="sky" animate />
        <SceneCopy className="max-md:pt-7 max-md:text-center">
          <Heading>
            A little friend.
            <br />A fresh start.
          </Heading>
          <div className="max-md:flex max-md:justify-center">
            <Description>
              Make everyday money feel a little more human. Start with a
              companion of your own.
            </Description>
          </div>
          <Button
            render={<Link href="/create" />}
            nativeButton={false}
            size="lg"
          >
            Create your Naru <span aria-hidden="true">↗</span>
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            Yours to name. Yours to make.
          </p>
        </SceneCopy>
      </Scene>
    </Frame>
  );
}
