function isAdmin(req, res, next) {
  const email =
    typeof process.env.ADMIN_EMAIL === "string"
      ? process.env.ADMIN_EMAIL.trim().toLowerCase()
      : "";
  const userEmail = String(req?.user?.email || "").trim().toLowerCase();
  const roleAdmin = req?.user?.role === "admin";
  const emailAdmin = email && userEmail === email;

  if (!roleAdmin && !emailAdmin) {
    return res
      .status(403)
      .json({ success: false, message: "Access denied. Admins only." });
  }
  return next();
}

module.exports = { isAdmin };
