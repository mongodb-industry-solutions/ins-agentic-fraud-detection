import { apiFetch, toQuery } from "./client";

/** Mirrors backend/routers/customers.py. */

export function listCustomers({ search, page = 1, limit = 25, sort = "-customerSince" } = {}) {
  return apiFetch(`/customers${toQuery({ search, page, limit, sort })}`);
}

export function getCustomer(customerId) {
  return apiFetch(`/customers/${customerId}`);
}
