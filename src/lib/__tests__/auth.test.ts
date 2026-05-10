import { vi, test, expect, beforeEach } from "vitest";

// "server-only" throws when imported outside a Next.js server context — stub it out
vi.mock("server-only", () => ({}));

// vi.hoisted() runs before imports are evaluated, ensuring these mocks are
// ready when the vi.mock factories below are hoisted to the top of the file.
const { mockGet, mockJwtVerify } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockJwtVerify: vi.fn(),
}));

// Mock next/headers so we control what the cookie store returns
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: mockGet }),
}));

// Mock jose so we don't need a real Web Crypto environment in jsdom.
// We're testing getSession's logic, not JWT cryptography itself.
vi.mock("jose", () => ({
  SignJWT: vi.fn(),
  jwtVerify: mockJwtVerify,
}));

import { getSession } from "@/lib/auth";

const VALID_PAYLOAD = {
  userId: "user-123",
  email: "test@example.com",
  expiresAt: new Date().toISOString(),
};

beforeEach(() => {
  mockGet.mockReset();
  mockJwtVerify.mockReset();
});

test("returns null when the auth-token cookie is absent", async () => {
  // cookieStore.get("auth-token") returns undefined — no cookie set
  mockGet.mockReturnValue(undefined);

  const session = await getSession();

  expect(session).toBeNull();
});

test("does not call jwtVerify when there is no cookie", async () => {
  mockGet.mockReturnValue(undefined);

  await getSession();

  expect(mockJwtVerify).not.toHaveBeenCalled();
});

test("reads the cookie using the correct name 'auth-token'", async () => {
  mockGet.mockReturnValue(undefined);

  await getSession();

  expect(mockGet).toHaveBeenCalledWith("auth-token");
});

test("returns null when jwtVerify throws (malformed or wrong-secret token)", async () => {
  mockGet.mockReturnValue({ value: "some-token" });
  // jose throws a JWSInvalidSignature / JWTExpired / etc. on bad tokens
  mockJwtVerify.mockRejectedValue(new Error("signature verification failed"));

  const session = await getSession();

  expect(session).toBeNull();
});

test("returns null when jwtVerify throws a JWTExpired error", async () => {
  mockGet.mockReturnValue({ value: "some-token" });
  const expiredError = new Error("JWT expired");
  expiredError.name = "JWTExpired";
  mockJwtVerify.mockRejectedValue(expiredError);

  const session = await getSession();

  expect(session).toBeNull();
});

test("returns the session payload when the token is valid", async () => {
  mockGet.mockReturnValue({ value: "valid-token" });
  mockJwtVerify.mockResolvedValue({ payload: VALID_PAYLOAD });

  const session = await getSession();

  expect(session).not.toBeNull();
  expect(session?.userId).toBe("user-123");
  expect(session?.email).toBe("test@example.com");
});

test("passes the token from the cookie to jwtVerify", async () => {
  mockGet.mockReturnValue({ value: "my-specific-token" });
  mockJwtVerify.mockResolvedValue({ payload: VALID_PAYLOAD });

  await getSession();

  // First argument to jwtVerify should be the raw token string
  expect(mockJwtVerify).toHaveBeenCalledWith(
    "my-specific-token",
    expect.anything() // the JWT_SECRET key — implementation detail
  );
});
