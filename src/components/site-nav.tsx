"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { SignInButton, SignOutButton, SignUpButton, useUser } from "@clerk/nextjs";

export function SiteNav({ hasAccessToken = false }: { hasAccessToken?: boolean }) {
  const { isSignedIn, user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? "";

  return (
    <header className="main-nav">
      <div className="logo-area">
        <Link href="/" aria-label="Gridworld Streaming home">
          <img src="/images/site_logo/gridworld_font_1_edit.png" alt="Logo" />
        </Link>
      </div>

      <div className="account-area">
        <div className="navbar-account-area">
          {!isSignedIn ? (
            <div className="auth-buttons">
              <SignInButton mode="redirect" fallbackRedirectUrl="/">
                <button type="button" className="legacy-button">
                  Login
                </button>
              </SignInButton>
              <SignUpButton mode="redirect" fallbackRedirectUrl="/">
                <button type="button" className="legacy-button">
                  Create Account
                </button>
              </SignUpButton>
            </div>
          ) : (
            <div className="logged-in-buttons">
              <Link href="/account" className="legacy-button account-button">
                <span className="email-text">{email}</span>
                <span className="short-text">My Account</span>
              </Link>
              <img
                src={hasAccessToken ? "/images/access_token/bw_invert.png" : "/images/access_token/bw_empty.png"}
                alt="User status"
                className="user-status-icon"
              />
              <SignOutButton>
                <button type="button" className="legacy-button logout-button">
                  Logout
                </button>
              </SignOutButton>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
