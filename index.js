import cors from "cors";
import "dotenv/config";
import express from "express";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const PORT = 5000;

app.use(cors([process.env.CLIENT_URL]));
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

app.post("/books", async (req, res) => {
  const booksData = req.body;
  const result = await booksCollection.insertOne(booksData);
  res.send(result);
});

app.get("/books", async (req, res) => {
  const result = await booksCollection.find().toArray();
  res.send(result);
});

app.get("/books/:id", async (req, res) => {
  const id = req.params.id;
  const result = await booksCollection.findOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.post("/my-borrows", async (req, res) => {
  const borrowData = req.body;
  const result = await booksBorrowCollection.insertOne(borrowData);
  res.send(result);
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});
