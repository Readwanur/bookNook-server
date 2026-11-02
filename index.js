import express from "express";
import "dotenv/config";
import cors from "cors";
import { MongoClient } from "mongodb";

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

app.post("/books", async (req, res) => {
  const booksData = req.body;
  const result = await booksCollection.insertOne(booksData);
  res.send(result);
});

app.get("/books", async (req, res) => {
  const result = await booksCollection.find().toArray();
  res.send(result);
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});
