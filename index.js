import cors from "cors";
import "dotenv/config";
import express from "express";
import jwt from "jsonwebtoken";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(
  cors({
    origin: [process.env.CLIENT_URL],
    credentials: true,
  }),
);
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectClient = await connectToMongoDB();
const db = connectClient.db("bookNook");
const booksCollection = db.collection("books");
const booksBorrowCollection = db.collection("booksBorrow");

// Issue JWT Token
app.post("/jwt", async (req, res) => {
  const { email, name } = req.body;
  if (!email) {
    return res.status(400).send({ error: "Email is required to issue JWT" });
  }

  const token = jwt.sign({ email, name }, JWT_SECRET, { expiresIn: "7d" });
  res.send({ success: true, token });
});

// 1. Add Book (Private - JWT Protected)
app.post("/books", verifyToken, async (req, res) => {
  try {
    const booksData = req.body;
    const copiesCount = Math.max(
      0,
      parseInt(booksData.copies ?? booksData.totalCopies ?? 1, 10) || 1,
    );

    const newBook = {
      ...booksData,
      copies: copiesCount,
      totalCopies: copiesCount,
      createdAt: booksData.createdAt || new Date().toISOString(),
      status: copiesCount > 0 ? "Available" : "Not Available",
    };

    const result = await booksCollection.insertOne(newBook);
    res.send(result);
  } catch (error) {
    console.error("Error adding book:", error);
    res.status(500).send({ error: "Failed to add book" });
  }
});

// 2. Get All Books (Public)
app.get("/books", async (req, res) => {
  try {
    const { category, email } = req.query;
    const filter = {};

    if (category && category !== "All") {
      filter.category = { $regex: new RegExp(`^${category}$`, "i") };
    }
    if (email) {
      filter.$or = [{ "addedBy.email": email }, { userEmail: email }];
    }

    const books = await booksCollection
      .find(filter)
      .sort({ _id: -1 })
      .toArray();

    // Ensure copies field is always a number (default 3 for older books)
    const normalized = books.map((b) => {
      const copies =
        typeof b.copies === "number"
          ? b.copies
          : typeof b.totalCopies === "number"
            ? b.totalCopies
            : 3;
      return {
        ...b,
        copies,
        totalCopies: typeof b.totalCopies === "number" ? b.totalCopies : copies,
      };
    });

    res.send(normalized);
  } catch (error) {
    console.error("Error fetching books:", error);
    res.status(500).send({ error: "Failed to fetch books" });
  }
});

// 3. Get Logged-in User's Added Books (Private - /my-books)
app.get("/my-books", verifyToken, async (req, res) => {
  try {
    const email = req.query.email || req.user?.email;
    if (!email) {
      return res.status(400).send({ error: "User email is required" });
    }

    const filter = {
      $or: [{ "addedBy.email": email }, { userEmail: email }],
    };

    const books = await booksCollection
      .find(filter)
      .sort({ _id: -1 })
      .toArray();
    const normalized = books.map((b) => {
      const copies =
        typeof b.copies === "number"
          ? b.copies
          : typeof b.totalCopies === "number"
            ? b.totalCopies
            : 3;
      return {
        ...b,
        copies,
        totalCopies: typeof b.totalCopies === "number" ? b.totalCopies : copies,
      };
    });

    res.send(normalized);
  } catch (error) {
    console.error("Error fetching my-books:", error);
    res.status(500).send({ error: "Failed to fetch user books" });
  }
});

// 4. Get Single Book Details by ID
app.get("/books/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid Book ID" });
    }

    const book = await booksCollection.findOne({ _id: new ObjectId(id) });
    if (!book) {
      return res.status(404).send({ error: "Book not found" });
    }

    const copies =
      typeof book.copies === "number"
        ? book.copies
        : typeof book.totalCopies === "number"
          ? book.totalCopies
          : 3;

    // Check if the current user already borrowed this book
    const userEmail = req.query.userEmail;
    let alreadyBorrowed = false;
    if (userEmail) {
      const existingBorrow = await booksBorrowCollection.findOne({
        bookId: id,
        userEmail: userEmail,
      });
      alreadyBorrowed = Boolean(existingBorrow);
    }

    res.send({
      ...book,
      copies,
      totalCopies:
        typeof book.totalCopies === "number" ? book.totalCopies : copies,
      status: copies > 0 ? "Available" : "Not Available",
      alreadyBorrowed,
    });
  } catch (error) {
    console.error("Error fetching book by ID:", error);
    res.status(500).send({ error: "Failed to fetch book details" });
  }
});

// 5. Update Book by ID (Private - /my-books Edit)
app.put("/books/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid Book ID" });
    }

    const {
      title,
      author,
      category,
      bookImage,
      description,
      copies,
      totalCopies,
    } = req.body;

    const parsedCopies = Math.max(
      0,
      parseInt(copies ?? totalCopies ?? 0, 10) || 0,
    );

    const updatedDoc = {
      $set: {
        title,
        author,
        category,
        bookImage,
        description,
        copies: parsedCopies,
        totalCopies: parsedCopies,
        status: parsedCopies > 0 ? "Available" : "Not Available",
        updatedAt: new Date().toISOString(),
      },
    };

    const result = await booksCollection.updateOne(
      { _id: new ObjectId(id) },
      updatedDoc,
    );
    res.send(result);
  } catch (error) {
    console.error("Error updating book:", error);
    res.status(500).send({ error: "Failed to update book" });
  }
});

// 6. Delete Book by ID (Private - /my-books Delete)
app.delete("/books/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid Book ID" });
    }

    const result = await booksCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    console.error("Error deleting book:", error);
    res.status(500).send({ error: "Failed to delete book" });
  }
});

// 7. Borrow a Book (Private)
app.post("/my-borrows", verifyToken, async (req, res) => {
  try {
    const borrowData = req.body;
    const { bookId, userEmail } = borrowData;

    // A) No Double Borrow Check: User cannot borrow the same book twice at the same time
    const alreadyBorrowed = await booksBorrowCollection.findOne({
      bookId: String(bookId),
      userEmail: userEmail,
    });

    if (alreadyBorrowed) {
      return res.status(409).send({
        code: "DOUBLE_BORROW",
        error:
          "You have already borrowed this book! You cannot borrow the same book two times at the same time.",
      });
    }

    // B) Check Available Copies & Decrease by 1 with $inc
    let remainingCopies = 0;

    if (bookId && ObjectId.isValid(bookId)) {
      const bookObjId = new ObjectId(bookId);
      const book = await booksCollection.findOne({ _id: bookObjId });

      if (!book) {
        return res.status(404).send({ error: "Book not found" });
      }

      // Initialize numeric copies if older book document didn't have it
      if (typeof book.copies !== "number") {
        const initialCopies =
          typeof book.totalCopies === "number" ? book.totalCopies : 3;
        await booksCollection.updateOne(
          { _id: bookObjId },
          { $set: { copies: initialCopies, totalCopies: initialCopies } },
        );
      }

      const currentCopies =
        typeof book.copies === "number"
          ? book.copies
          : typeof book.totalCopies === "number"
            ? book.totalCopies
            : 3;

      if (currentCopies <= 0) {
        return res.status(400).send({
          code: "OUT_OF_STOCK",
          error: "This book is currently Not Available (0 copies left).",
        });
      }

      // Decrease copies by 1 using $inc
      await booksCollection.updateOne(
        { _id: bookObjId },
        { $inc: { copies: -1 } },
      );

      remainingCopies = currentCopies - 1;
      await booksCollection.updateOne(
        { _id: bookObjId },
        {
          $set: {
            status: remainingCopies > 0 ? "Available" : "Not Available",
          },
        },
      );
    }

    // C) Save borrow document in booksBorrowCollection
    const result = await booksBorrowCollection.insertOne(borrowData);
    res.send({
      ...result,
      remainingCopies,
    });
  } catch (error) {
    console.error("Error borrowing book:", error);
    res.status(500).send({ error: "Failed to borrow book" });
  }
});

// 8. Get Logged-in User's Borrowed Books (Private)
app.get("/my-borrows", verifyToken, async (req, res) => {
  try {
    const email = req.query.email || req.user?.email;
    const query = email ? { userEmail: email } : {};

    const result = await booksBorrowCollection
      .find(query)
      .sort({ _id: -1 })
      .toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching borrowed books:", error);
    res.status(500).send({ error: "Failed to fetch borrowed books" });
  }
});

// 9. Return a Borrowed Book & Increase Copies by 1 with $inc (Private)
app.delete("/my-borrows/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid Borrow ID" });
    }

    // Find the borrow record first to get its bookId
    const borrowDoc = await booksBorrowCollection.findOne({
      _id: new ObjectId(id),
    });

    // Delete the borrow record
    const result = await booksBorrowCollection.deleteOne({
      _id: new ObjectId(id),
    });

    // Increase the book's available copies by 1 using $inc
    if (borrowDoc?.bookId && ObjectId.isValid(borrowDoc.bookId)) {
      const bookObjId = new ObjectId(borrowDoc.bookId);
      const book = await booksCollection.findOne({ _id: bookObjId });

      if (book) {
        if (typeof book.copies !== "number") {
          const initialCopies =
            typeof book.totalCopies === "number" ? book.totalCopies : 3;
          await booksCollection.updateOne(
            { _id: bookObjId },
            { $set: { copies: initialCopies, totalCopies: initialCopies } },
          );
        }

        await booksCollection.updateOne(
          { _id: bookObjId },
          {
            $inc: { copies: 1 },
            $set: { status: "Available" },
          },
        );
      }
    }

    res.send(result);
  } catch (error) {
    console.error("Error returning book:", error);
    res.status(500).send({ error: "Failed to return book" });
  }
});

app.get("/", (req, res) => {
  res.send("BookNook Server is running!");
});

app.listen(PORT, () => {
  console.log(`BookNook server listening on port ${PORT}`);
});
