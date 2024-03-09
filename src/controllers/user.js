const { hash, compare } = require("bcryptjs");
const { sign } = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const User = require("../models/User");

exports.register = async (req, res, next) => {
  const {
    username,
    email,
    password,
    role,
    name,
    phone,
    events,
    genre,
    link,
    social,
    price,
    image,
    direction,
    capacity,
    description,
  } = req.body;

  console.log(req);

  if (!username || !email || !password || !role) {
    return res.status(400).send("Please fill in all the required fields!");
  }

  try {
    const userObj = {
      username,
      email,
      password: await hash(password, 12),
      role,
      name,
      phone,
      events,
      genre,
      link,
      social,
      price,
      image,
      direction,
      capacity,
      description,
    };

    const user = await new User(userObj).save();

    const token = sign({ [role]: user }, process.env.JWT_SECRET, {
      expiresIn: 360000,
    });

    return res.status(201).json({
      token,
      user: { ...user._doc, password: null },
    });
  } catch (error) {
    return res.status(500).send(error.message);
  }
};

exports.login = async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email }).lean();
    if (!user) return res.status(404).send("Invalid credentials");
    if (user.role !== "user")
      return res.status(404).send("Invalid credentials..");
    const isMatch = await compare(password, user.password);
    if (!isMatch) return res.status(400).send("Invalid credentials");
    const token = sign({ user }, process.env.JWT_SECRET, { expiresIn: 360000 });
    return res.status(200).json({ token, user: { ...user, password: null } });
  } catch (error) {
    return res.status(500).send(error.message);
  }
};

exports.getAuthUser = async (req, res, next) => {
  try {
    const user = await User.findById(req?.user?._id).select("-password").lean();
    if (!user)
      return res.status(400).send("User not found, Authorization denied..");
    return res.status(200).json({ ...user });
  } catch (error) {
    return res.status(500).send(error.message);
  }
};

exports.updateUser = async (req, res, next) => {
  const { userId } = req.params;
  const updateFields = req.body;

  if (req.file) {
    updateFields.image = req.file.location;
  }

  try {
    const userToUpdate = await User.findByIdAndUpdate(userId, updateFields, {
      new: true,
    });
    return res.status(200).json({
      ...userToUpdate.toObject(),
      password: null,
    });
  } catch (error) {
    return res.status(500).send(error.message);
  }
};

exports.getUsers = async (req, res, next) => {
  try {
    const users = await User.find().select("-password").lean();
    return res.status(200).json(users);
  } catch (error) {
    return res.status(500).send(error.message);
  }
};

exports.sendRequests = async (req, res) => {
  const { userId, businessIds } = req.body;
  console.log(
    "Received sendRequests with userId:",
    userId,
    "and businessIds:",
    businessIds
  );

  try {
    const user = await User.findById(userId);
    console.log("User found:", !!user);
    if (!user) return res.status(404).send("User not found");

    if (
      user.lastRequestDate &&
      new Date() - new Date(user.lastRequestDate) < 7 * 24 * 60 * 60 * 1000
    ) {
      console.log(
        "User cannot submit requests yet, lastRequestDate:",
        user.lastRequestDate
      );
      return res.status(400).send("You can only submit requests once a week");
    }

    user.requestList = businessIds;
    user.lastRequestDate = new Date();
    console.log("Updating user with new requestList and lastRequestDate");

    await user.save();
    console.log("User updated successfully");

    res.status(200).send("Requests sent successfully");
  } catch (error) {
    console.error("Error processing sendRequests:", error);
    res.status(500).send(error.message);
  }
};

exports.checkApplication = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).send("User not found");

    // Comprueba si ha pasado una semana desde el último envío
    const canApply =
      !user.lastRequestDate ||
      new Date() - new Date(user.lastRequestDate) >= 7 * 24 * 60 * 60 * 1000;

    res.status(200).json({ canApply, lastRequestDate: user.lastRequestDate });
  } catch (error) {
    res.status(500).send(error.message);
  }
};

exports.googleRegister = async (req, res) => {
  const { token, role } = req.body; // Recoger el rol desde el cuerpo de la solicitud
  try {
    // Verificar el token ID con Google
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    // Buscar si el usuario ya existe en la DB
    let user = await User.findOne({ email: payload.email });

    if (!user) {
      // Si el usuario no existe, crear uno nuevo
      user = await User.create({
        email: payload.email,
        username: payload.name,
        role: role || "user",
        authenticationMethod: "google", // Utilizar el rol proporcionado o establecer "user" como valor predeterminado
        // La contraseña no se establece; la autenticación es por Google
      });
    }

    // Generar JWT para el usuario
    const jwtToken = sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // Enviar token al cliente
    res.status(200).json({
      token: jwtToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error verificando el token de Google", error);
    res.status(500).send("Error de autenticación con Google");
  }
};

exports.googleLogin = async (req, res) => {
  const { token } = req.body; // Recoger el token desde el cuerpo de la solicitud
  try {
    // Verificar el token ID con Google
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    // Buscar si el usuario existe en la DB
    const user = await User.findOne({ email: payload.email });

    if (!user) {
      // Si el usuario no existe, devolver un error de autenticación
      return res.status(401).send("Usuario no encontrado");
    }

    // Generar JWT para el usuario
    const jwtToken = sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // Enviar token al cliente
    res.status(200).json({
      token: jwtToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Error verificando el token de Google", error);
    res.status(500).send("Error de autenticación con Google");
  }
};
