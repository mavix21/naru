"use client";

import type { ReactNode } from "react";

import { api } from "@naru/backend/api";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";

import { UsernameForm } from "@/components/social/UsernameForm";
import { profilePath } from "@/lib/profile";

import { ProfileSettings } from "./ProfileSettings";

export function UsernameCompletion({
  profileHeading,
  profileLoading,
}: {
  profileHeading: ReactNode;
  profileLoading: ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const profile = useQuery(api.profiles.current, isAuthenticated ? {} : "skip");

  if (!isAuthenticated || profile === undefined)
    return <output>Loading your profile…</output>;

  return (
    <div className="space-y-8">
      {profile?.username ? (
        <div className="space-y-3">
          <h1 className="text-3xl tracking-tight">Your link is ready.</h1>
          <Link
            href={profilePath(profile.username)}
            className="text-sm font-medium underline underline-offset-4"
          >
            View public profile ↗
          </Link>
        </div>
      ) : (
        <UsernameForm />
      )}
      {profile && (
        <div className="border-t pt-6">
          <ProfileSettings heading={profileHeading} loading={profileLoading} />
        </div>
      )}
      <Link
        href="/home"
        className="block text-sm font-medium underline underline-offset-4"
      >
        {profile?.username ? "Continue to Naru →" : "Back to Naru"}
      </Link>
    </div>
  );
}
