import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// --- mock setup -----------------------------------------------------------

// useRouter must be mocked before the hook is imported so Next.js internals
// don't blow up in jsdom.
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Server actions — we only care about the shape they return, not their
// real implementation (which requires a Next.js server context).
const mockSignInAction = vi.fn();
const mockSignUpAction = vi.fn();
vi.mock("@/actions", () => ({
  signIn: (...args: unknown[]) => mockSignInAction(...args),
  signUp: (...args: unknown[]) => mockSignUpAction(...args),
}));

const mockGetAnonWorkData = vi.fn();
const mockClearAnonWork = vi.fn();
vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: () => mockGetAnonWorkData(),
  clearAnonWork: () => mockClearAnonWork(),
}));

const mockGetProjects = vi.fn();
vi.mock("@/actions/get-projects", () => ({
  getProjects: () => mockGetProjects(),
}));

const mockCreateProject = vi.fn();
vi.mock("@/actions/create-project", () => ({
  createProject: (...args: unknown[]) => mockCreateProject(...args),
}));

// --- import the hook after all mocks are wired up -------------------------
import { useAuth } from "@/hooks/use-auth";

// --------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Safe defaults — override per-test as needed
  mockSignInAction.mockResolvedValue({ success: false, error: "Invalid credentials" });
  mockSignUpAction.mockResolvedValue({ success: false, error: "Email already registered" });
  mockGetAnonWorkData.mockReturnValue(null);
  mockGetProjects.mockResolvedValue([]);
  mockCreateProject.mockResolvedValue({ id: "new-project-id" });
});

// ==========================================================================
// isLoading state
// ==========================================================================

describe("isLoading", () => {
  test("starts as false", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isLoading).toBe(false);
  });

  test("is true while signIn is in-flight", async () => {
    // Never resolves during this test — lets us inspect mid-flight state
    let resolve!: (v: unknown) => void;
    mockSignInAction.mockReturnValue(new Promise((r) => (resolve = r)));

    const { result } = renderHook(() => useAuth());

    act(() => {
      result.current.signIn("a@b.com", "password1");
    });

    expect(result.current.isLoading).toBe(true);

    // Clean up — resolve so React isn't left with a dangling state update
    await act(async () => resolve({ success: false }));
  });

  test("resets to false after signIn resolves successfully", async () => {
    mockSignInAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue(null);
    mockGetProjects.mockResolvedValue([{ id: "p1" }]);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    expect(result.current.isLoading).toBe(false);
  });

  test("resets to false after signIn resolves with failure", async () => {
    mockSignInAction.mockResolvedValue({ success: false, error: "bad creds" });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "wrong");
    });

    expect(result.current.isLoading).toBe(false);
  });

  test("resets to false even when signIn throws", async () => {
    mockSignInAction.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      try {
        await result.current.signIn("a@b.com", "password1");
      } catch {
        // expected
      }
    });

    expect(result.current.isLoading).toBe(false);
  });

  test("is true while signUp is in-flight", async () => {
    let resolve!: (v: unknown) => void;
    mockSignUpAction.mockReturnValue(new Promise((r) => (resolve = r)));

    const { result } = renderHook(() => useAuth());

    act(() => {
      result.current.signUp("a@b.com", "password1");
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => resolve({ success: false }));
  });

  test("resets to false after signUp resolves", async () => {
    mockSignUpAction.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("a@b.com", "password1");
    });

    expect(result.current.isLoading).toBe(false);
  });
});

// ==========================================================================
// signIn — return value and action forwarding
// ==========================================================================

describe("signIn", () => {
  test("forwards email and password to the signIn server action", async () => {
    mockSignInAction.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("user@example.com", "s3cr3t!");
    });

    expect(mockSignInAction).toHaveBeenCalledWith("user@example.com", "s3cr3t!");
  });

  test("returns the result from the server action on failure", async () => {
    const serverResult = { success: false, error: "Invalid credentials" };
    mockSignInAction.mockResolvedValue(serverResult);

    const { result } = renderHook(() => useAuth());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.signIn("a@b.com", "wrong");
    });

    expect(returned).toEqual(serverResult);
  });

  test("returns the result from the server action on success", async () => {
    mockSignInAction.mockResolvedValue({ success: true });
    mockGetProjects.mockResolvedValue([{ id: "p1" }]);

    const { result } = renderHook(() => useAuth());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.signIn("a@b.com", "password1");
    });

    expect(returned).toEqual({ success: true });
  });

  test("does not navigate when signIn fails", async () => {
    mockSignInAction.mockResolvedValue({ success: false, error: "bad creds" });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "wrong");
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  test("propagates thrown errors from the server action", async () => {
    mockSignInAction.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useAuth());

    await expect(
      act(async () => {
        await result.current.signIn("a@b.com", "password1");
      })
    ).rejects.toThrow("network error");
  });
});

// ==========================================================================
// signUp — return value and action forwarding
// ==========================================================================

describe("signUp", () => {
  test("forwards email and password to the signUp server action", async () => {
    mockSignUpAction.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("new@example.com", "mypassword");
    });

    expect(mockSignUpAction).toHaveBeenCalledWith("new@example.com", "mypassword");
  });

  test("returns the result from the server action on failure", async () => {
    const serverResult = { success: false, error: "Email already registered" };
    mockSignUpAction.mockResolvedValue(serverResult);

    const { result } = renderHook(() => useAuth());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.signUp("existing@example.com", "password1");
    });

    expect(returned).toEqual(serverResult);
  });

  test("does not navigate when signUp fails", async () => {
    mockSignUpAction.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("a@b.com", "password1");
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  test("propagates thrown errors from the server action", async () => {
    mockSignUpAction.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useAuth());

    await expect(
      act(async () => {
        await result.current.signUp("a@b.com", "password1");
      })
    ).rejects.toThrow("server down");
  });
});

// ==========================================================================
// post-sign-in navigation: anonymous work present
// ==========================================================================

describe("post-sign-in: anonymous work with messages", () => {
  const anonWork = {
    messages: [{ role: "user", content: "Hello" }],
    fileSystemData: { "/App.jsx": { type: "file", content: "<div/>" } },
  };

  beforeEach(() => {
    mockSignInAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue(anonWork);
    mockCreateProject.mockResolvedValue({ id: "anon-project-id" });
  });

  test("creates a project using the anon work data", async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    expect(mockCreateProject).toHaveBeenCalledWith({
      name: expect.stringContaining("Design from"),
      messages: anonWork.messages,
      data: anonWork.fileSystemData,
    });
  });

  test("clears anon work after creating the project", async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    expect(mockClearAnonWork).toHaveBeenCalled();
  });

  test("navigates to the newly created project", async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    expect(mockPush).toHaveBeenCalledWith("/anon-project-id");
  });

  test("does not fetch existing projects when anon work is present", async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    expect(mockGetProjects).not.toHaveBeenCalled();
  });

  test("same behaviour triggers on signUp success with anon work", async () => {
    mockSignUpAction.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("new@example.com", "password1");
    });

    expect(mockCreateProject).toHaveBeenCalled();
    expect(mockClearAnonWork).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/anon-project-id");
  });
});

// ==========================================================================
// post-sign-in navigation: anonymous work present but empty messages
// ==========================================================================

describe("post-sign-in: anonymous work with no messages", () => {
  beforeEach(() => {
    mockSignInAction.mockResolvedValue({ success: true });
    // anonWork exists but messages array is empty — should be treated as "no work"
    mockGetAnonWorkData.mockReturnValue({ messages: [], fileSystemData: {} });
  });

  test("falls through to getProjects when anon messages are empty", async () => {
    mockGetProjects.mockResolvedValue([{ id: "existing-id" }]);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    expect(mockGetProjects).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/existing-id");
  });

  test("does not call createProject with anon data when messages are empty", async () => {
    mockGetProjects.mockResolvedValue([{ id: "existing-id" }]);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    // createProject must not be called with anon data; it may be called for
    // new-project creation only if getProjects returns [] (not the case here)
    expect(mockCreateProject).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// post-sign-in navigation: no anonymous work, existing projects
// ==========================================================================

describe("post-sign-in: no anonymous work, existing projects", () => {
  beforeEach(() => {
    mockSignInAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue(null);
  });

  test("redirects to the most recent project", async () => {
    mockGetProjects.mockResolvedValue([
      { id: "latest-project" },
      { id: "older-project" },
    ]);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    expect(mockPush).toHaveBeenCalledWith("/latest-project");
  });

  test("does not create a project when one already exists", async () => {
    mockGetProjects.mockResolvedValue([{ id: "existing-id" }]);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  test("works the same way on signUp success", async () => {
    mockSignUpAction.mockResolvedValue({ success: true });
    mockGetProjects.mockResolvedValue([{ id: "p99" }]);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("new@example.com", "password1");
    });

    expect(mockPush).toHaveBeenCalledWith("/p99");
  });
});

// ==========================================================================
// post-sign-in navigation: no anonymous work, no existing projects
// ==========================================================================

describe("post-sign-in: no anonymous work, no existing projects", () => {
  beforeEach(() => {
    mockSignInAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue(null);
    mockGetProjects.mockResolvedValue([]);
    mockCreateProject.mockResolvedValue({ id: "brand-new-id" });
  });

  test("creates a new project", async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    expect(mockCreateProject).toHaveBeenCalledWith({
      name: expect.stringMatching(/^New Design #\d+$/),
      messages: [],
      data: {},
    });
  });

  test("navigates to the newly created project", async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("a@b.com", "password1");
    });

    expect(mockPush).toHaveBeenCalledWith("/brand-new-id");
  });

  test("works the same way on signUp success", async () => {
    mockSignUpAction.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("new@example.com", "password1");
    });

    expect(mockCreateProject).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/brand-new-id");
  });
});
