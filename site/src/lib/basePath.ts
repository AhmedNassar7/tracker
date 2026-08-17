// import.meta.env.BASE_URL isn't guaranteed to carry a trailing slash in
// this Astro version — normalize once here rather than duplicating the
// same check in every file that builds a base-relative URL.
export const BASE_URL = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
