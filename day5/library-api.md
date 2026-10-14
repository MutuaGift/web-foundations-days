# Library API Design

A REST API for the **books** resource of a small library system. This document
describes every endpoint: the method, the path, what it does, an example request
body where one is needed, and the status code returned on success.

- **Base URL:** `https://api.example-library.com/v1`
- **Format:** JSON in both directions
- **Authentication:** a bearer token in the `Authorization` header on every request

## The book resource

A single book looks like this:

- **id** — integer, assigned by the server
- **title** — string, required
- **author** — string, required
- **isbn** — string, required and unique
- **year** — integer, the year of publication
- **available** — boolean, whether the book is on the shelf

```json
{
  "id": 12,
  "title": "The Pragmatic Programmer",
  "author": "Andrew Hunt",
  "isbn": "978-0135957059",
  "year": 1999,
  "available": true
}
```

## Endpoints

### 1. List all books

- **Method:** `GET`
- **Path:** `/books`
- **Description:** Returns every book in the library, with pagination.
- **Query parameters:**
  - `page` — which page of results to return, starting at 1
  - `limit` — how many books per page, maximum 100
- **Example request body:** none, this is a read
- **Success status:** `200 OK`

```
GET /v1/books?page=1&limit=20
```

```json
{
  "page": 1,
  "limit": 20,
  "total": 143,
  "books": [ { "id": 12, "title": "The Pragmatic Programmer", "...": "..." } ]
}
```

### 2. Get a single book

- **Method:** `GET`
- **Path:** `/books/{id}`
- **Description:** Returns one book by its id.
- **Example request body:** none, this is a read
- **Success status:** `200 OK`

```
GET /v1/books/12
```

### 3. Create a book

- **Method:** `POST`
- **Path:** `/books`
- **Description:** Adds a new book to the library. The server assigns the `id`.
- **Example request body:**

```json
{
  "title": "Clean Code",
  "author": "Robert C. Martin",
  "isbn": "978-0132350884",
  "year": 2008
}
```

- **Success status:** `201 Created`, with the new book in the response body
- **Also sets:** a `Location` header pointing at the new book

### 4. Update a book

- **Method:** `PUT`
- **Path:** `/books/{id}`
- **Description:** Replaces an existing book. Send the full book, because fields
  you leave out are removed.
- **Example request body:**

```json
{
  "title": "Clean Code",
  "author": "Robert C. Martin",
  "isbn": "978-0132350884",
  "year": 2008,
  "available": false
}
```

- **Success status:** `200 OK`, with the updated book in the response body

### 5. Partially update a book

- **Method:** `PATCH`
- **Path:** `/books/{id}`
- **Description:** Changes only the fields you send, leaving the rest untouched.
  Use this instead of `PUT` for a small change.
- **Example request body:**

```json
{ "available": false }
```

- **Success status:** `200 OK`, with the updated book in the response body

### 6. Delete a book

- **Method:** `DELETE`
- **Path:** `/books/{id}`
- **Description:** Removes a book from the library permanently.
- **Example request body:** none, there is nothing to send
- **Success status:** `204 No Content`, with an empty response body

### 7. List books by author

- **Method:** `GET`
- **Path:** `/books?author={author}`
- **Description:** Returns only the books written by one author. The `author`
  value is matched without regard to case.
- **Query parameters:**
  - `author` — the author's name, required for this endpoint
- **Example request body:** none, this is a read
- **Success status:** `200 OK`

```
GET /v1/books?author=Andrew%20Hunt
```

```json
{
  "total": 2,
  "books": [
    { "id": 12, "title": "The Pragmatic Programmer", "author": "Andrew Hunt", "...": "..." },
    { "id": 31, "title": "The Pragmatic Programmer Journey", "author": "Andrew Hunt", "...": "..." }
  ]
}
```

### Endpoint summary

| Method   | Path                    | Description                        | Success |
| -------- | ----------------------- | ---------------------------------- | ------- |
| `GET`    | `/books`                | List all books                     | 200     |
| `GET`    | `/books?author=`        | List books by author               | 200     |
| `GET`    | `/books/{id}`           | Get one book                       | 200     |
| `POST`   | `/books`                | Create a book                      | 201     |
| `PUT`    | `/books/{id}`           | Replace a book                     | 200     |
| `PATCH`  | `/books/{id}`           | Partially update a book            | 200     |
| `DELETE` | `/books/{id}`           | Delete a book                      | 204     |

## Error codes

Every error comes back in the same shape, so a client can handle them
consistently:

```json
{
  "error": "Bad Request",
  "message": "The field \"isbn\" is required."
}
```

### 400 Bad Request

- **Meaning:** the request was understood, but something about it is invalid.
  The client must fix it and try again.
- **Example:** `POST /v1/books` with no `isbn` in the body.

```
POST /v1/books
{ "title": "Clean Code", "author": "Robert C. Martin" }
```

- **Response:** `400 Bad Request`

```json
{
  "error": "Bad Request",
  "message": "The field \"isbn\" is required."
}
```

- **Other common causes:**
  - `year` sent as text instead of a number
  - `GET /books?limit=500`, above the maximum of 100
  - `GET /books?page=-1`, because page numbers start at 1

### 404 Not Found

- **Meaning:** the server has no resource at that address. Nothing was changed.
- **Example:** asking for a book id that is not in the library.

```
GET /v1/books/9999
```

- **Response:** `404 Not Found`

```json
{
  "error": "Not Found",
  "message": "No book was found with id 9999."
}
```

- **Other common causes:**
  - `DELETE /v1/books/9999` for a book that was already deleted
  - `GET /books?author=Ursula Le Guin` when she has no books in the system,
  which returns 200 with an empty list, so this applies mainly to the
  `/books/{id}` paths

## Notes on design

- **`GET` never changes anything.** The method alone says whether a request
  reads or writes, so the same URL is safe to cache and to call repeatedly.
- **Nouns, not verbs, in the paths.** `/books` and `/books/{id}` stay the same
  whatever the action; the HTTP method supplies the verb.
- **One status code per outcome.** 200 for a successful read or update, 201 for
  something newly created, 204 for a successful delete with nothing to return,
  400 for a fixable mistake, 404 for a resource that is not there.
- **Filtering belongs in the query string.** `?author=` keeps the endpoint list
  short instead of adding a path such as `/authors/{id}/books`.