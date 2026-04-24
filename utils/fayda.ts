import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { backendGet, backendPost } from "./api";

export type FaydaPurpose = "login" | "register";

export interface FaydaAuthorizeResponse {
  authorization_url: string;
  state: string;
  expires_in: number;
  redirect_uri: string;
}

export interface FaydaMatchedProfile {
  exists: boolean;
  user_id?: string | null;
  role?: string | null;
  full_name?: string | null;
  phone?: string | null;
}

export interface FaydaExchangeResponse {
  verified: boolean;
  purpose: FaydaPurpose;
  individual_id?: string | null;
  full_name?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  birthdate?: string | null;
  gender?: string | null;
  matched_profile: FaydaMatchedProfile;
}

const FALLBACK_REDIRECT_URI = "ambulanceemergencyapp://fayda/callback";

const buildRedirectUri = (): string => {
  if (Platform.OS === "web") {
    return Linking.createURL("fayda/callback");
  }
  return FALLBACK_REDIRECT_URI;
};

const getAuthorizeUrl = async (
  purpose: FaydaPurpose,
  redirectUri: string,
): Promise<FaydaAuthorizeResponse> => {
  const query = `purpose=${encodeURIComponent(purpose)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return backendGet<FaydaAuthorizeResponse>(
    `/auth/fayda/authorize-url?${query}`,
  );
};

const exchangeCode = async (
  code: string,
  state: string,
  redirectUri: string,
): Promise<FaydaExchangeResponse> => {
  return backendPost<FaydaExchangeResponse>("/auth/fayda/exchange", {
    code,
    state,
    redirect_uri: redirectUri,
  });
};

const readParam = (
  queryParams: Record<string, string | string[] | undefined>,
  key: string,
): string => {
  const value = queryParams[key];
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value || "");
};

export const toPhoneInputDigits = (phoneNumber?: string | null): string => {
  const digits = String(phoneNumber || "").replace(/[^0-9]/g, "");
  if (!digits) return "";

  if (digits.startsWith("251") && digits.length >= 12) {
    return digits.slice(3, 12);
  }

  if (digits.startsWith("0") && digits.length >= 10) {
    return digits.slice(1, 10);
  }

  if (digits.length >= 9) {
    return digits.slice(-9);
  }

  return digits;
};

export async function startFaydaOAuth(
  purpose: FaydaPurpose,
): Promise<FaydaExchangeResponse> {
  if (Platform.OS === "web") {
    throw new Error("Fayda OAuth is available on Android and iOS builds.");
  }

  const redirectUri = buildRedirectUri();
  const authInit = await getAuthorizeUrl(purpose, redirectUri);

  const result = await WebBrowser.openAuthSessionAsync(
    authInit.authorization_url,
    redirectUri,
  );

  if (result.type !== "success" || !result.url) {
    if (result.type === "cancel" || result.type === "dismiss") {
      throw new Error("Fayda sign-in was canceled.");
    }
    throw new Error("Fayda sign-in did not complete.");
  }

  const parsed = Linking.parse(result.url);
  const code = readParam(parsed.queryParams || {}, "code");
  const state = readParam(parsed.queryParams || {}, "state");
  const oauthError = readParam(parsed.queryParams || {}, "error");
  const oauthErrorDescription = readParam(
    parsed.queryParams || {},
    "error_description",
  );

  if (oauthError) {
    throw new Error(oauthErrorDescription || oauthError);
  }

  if (!code || !state) {
    throw new Error("Missing authorization code from Fayda callback.");
  }

  return exchangeCode(code, state, redirectUri);
}
