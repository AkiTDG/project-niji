// ================================
// SIGN UP
// ================================

async function signUp(name, email, password) {
    try {

        const user = await account.create({
            userId: Appwrite.ID.unique(),
            email: email,
            password: password,
            name: name
        });

        console.log("Account created:", user);

        // Automatically log the new user in
        await login(email, password);

    } catch (error) {

        console.error("Sign-up error:", error);

        throw error;
    }
}


// ================================
// LOGIN
// ================================

async function login(email, password) {
    try {

        const session = await account.createEmailPasswordSession({
            email: email,
            password: password
        });

        console.log("Login successful:", session);

        window.location.href = "index.html";

    } catch (error) {

        console.error("Login error:", error);

        throw error;
    }
}


// ================================
// GET CURRENT USER
// ================================

async function getCurrentUser() {

    try {

        const user = await account.get();

        return user;

    } catch (error) {

        return null;
    }
}


// ================================
// LOGOUT
// ================================

async function logout() {

    try {

        await account.deleteSession({
            sessionId: "current"
        });

        window.location.href = "index.html";

    } catch (error) {

        console.error("Logout error:", error);
    }
}