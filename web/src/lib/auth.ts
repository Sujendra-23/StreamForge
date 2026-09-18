const TOKEN_KEY = "sf-operator-token";

export function operatorToken() {
  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export function setOperatorToken(token: string) {
  const value = token.trim();
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function operatorHeaders(): HeadersInit {
  const token = operatorToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
