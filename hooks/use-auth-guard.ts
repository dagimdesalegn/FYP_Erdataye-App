import { useAppState } from "@/components/app-state";
import { useRouter, useSegments } from "expo-router";
import { useEffect } from "react";

/**
 * Redirects unauthenticated users to /login.
 * For role-restricted screens, pass allowedRoles to also check the user's role.
 * Returns true while auth is still loading (caller can show a spinner).
 */
export function useAuthGuard(allowedRoles?: string[]): boolean {
  const { user, isLoading } = useAppState();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    if (allowedRoles && allowedRoles.length > 0) {
      const userRole = user.role ?? "";
      if (!allowedRoles.includes(userRole)) {
        router.replace("/login");
      }
    }
  }, [user, isLoading, allowedRoles, router, segments]);

  return isLoading;
}
