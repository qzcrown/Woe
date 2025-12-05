import { Authenticator } from "../../src/middleware/auth";

describe("Authenticator", () => {
  let auth: Authenticator;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      prepare: jest.fn().mockReturnThis(),
      bind: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue({ id: 1, userId: 1, isAdmin: false })
    };
    auth = new Authenticator(mockDb);
  });

  describe("extractToken", () => {
    test("should extract token from X-Gotify-Key header", () => {
      const request = new Request("http://localhost", {
        headers: { "X-Gotify-Key": "A123456789" }
      });
      const token = (auth as any).extractToken(request);
      expect(token).toBe("A123456789");
    });

    test("should extract token from Authorization Bearer", () => {
      const request = new Request("http://localhost", {
        headers: { "Authorization": "Bearer C123456789" }
      });
      const token = (auth as any).extractToken(request);
      expect(token).toBe("C123456789");
    });

    test("should extract token from query parameter", () => {
      const request = new Request("http://localhost?token=querytoken");
      const token = (auth as any).extractToken(request);
      expect(token).toBe("querytoken");
    });

    test("should return null for no token", () => {
      const request = new Request("http://localhost");
      const token = (auth as any).extractToken(request);
      expect(token).toBeNull();
    });
  });

  describe("authenticate", () => {
    test("should authenticate application token", async () => {
      mockDb.first.mockResolvedValue({
        id: 1,
        userId: 1,
        isAdmin: false
      });

      const request = new Request("http://localhost", {
        headers: { "X-Gotify-Key": "A123456789" }
      });

      const result = await auth.authenticate(request);
      expect(result).toBeDefined();
      expect(result?.userId).toBe(1);
      expect(result?.tokenType).toBe("app");
    });

    test("should authenticate client token", async () => {
      mockDb.first.mockResolvedValue({
        id: 1,
        userId: 1,
        isAdmin: false
      });

      const request = new Request("http://localhost", {
        headers: { "X-Gotify-Key": "C123456789" }
      });

      const result = await auth.authenticate(request);
      expect(result).toBeDefined();
      expect(result?.tokenType).toBe("client");
    });

    test("should return null for invalid token", async () => {
      mockDb.first.mockResolvedValue(null);

      const request = new Request("http://localhost", {
        headers: { "X-Gotify-Key": "invalid" }
      });

      const result = await auth.authenticate(request);
      expect(result).toBeNull();
    });
  });
});
