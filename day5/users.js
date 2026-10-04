/* ============================================
   Day 5 - fetching data with the Fetch API
   ============================================ */

const API_URL = "https://jsonplaceholder.typicode.com/users";

/* Select the elements we need */
const loadBtn = document.getElementById("load-users");
const filterInput = document.getElementById("filter-input");
const statusEl = document.getElementById("status");
const usersList = document.getElementById("users-list");

/* The users stay in memory once loaded, so filtering never
   needs another request. */
let users = [];

/* Draw any array of users. Every value is written with
   textContent, so fetched data is never treated as markup. */
function renderUsers(list) {
  usersList.replaceChildren();

  if (list.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No users match your filter.";
    usersList.appendChild(empty);
    return;
  }

  list.forEach(function (user) {
    const item = document.createElement("li");
    item.className = "user-card";

    const name = document.createElement("h2");
    name.textContent = user.name;
    item.appendChild(name);

    const email = document.createElement("p");
    email.className = "user-email";
    email.textContent = user.email;
    item.appendChild(email);

    const city = document.createElement("p");
    city.className = "user-city";
    // the API nests the city inside address, and company name inside company
    city.textContent = user.address ? user.address.city : "";
    item.appendChild(city);

    const company = document.createElement("p");
    company.className = "user-company";
    company.textContent = user.company ? user.company.name : "";
    item.appendChild(company);

    usersList.appendChild(item);
  });
}

/* Filter the stored users by name, ignoring case. */
function filterUsers(query) {
  const needle = query.trim().toLowerCase();

  if (needle === "") {
    return users;
  }

  return users.filter(function (user) {
    return user.name.toLowerCase().includes(needle);
  });
}

/* Fetch the users from the API. */
async function loadUsers() {
  // stop the user clicking twice, and show that we are busy
  loadBtn.disabled = true;
  statusEl.classList.remove("is-error");
  statusEl.textContent = "Loading users...";
  usersList.replaceChildren();

  try {
    const response = await fetch(API_URL);

    // fetch only rejects on a network failure, not on 404 or 500,
    // so the status has to be checked by hand
    if (!response.ok) {
      throw new Error("the server replied with " + response.status);
    }

    users = await response.json();

    renderUsers(users);
    statusEl.textContent = "Loaded " + users.length + " users.";
  } catch (error) {
    // clear anything half-loaded so the page is not left in a strange state
    users = [];
    usersList.replaceChildren();

    statusEl.classList.add("is-error");
    statusEl.textContent = "Could not load users: " + error.message;
  } finally {
    // runs whether the request succeeded or failed
    loadBtn.disabled = false;
  }
}

/* Load on click */
loadBtn.addEventListener("click", loadUsers);

/* Filter as the user types, using the users we already have */
filterInput.addEventListener("input", function () {
  if (users.length === 0) {
    // nothing loaded yet, so there is nothing to filter
    return;
  }

  const visible = filterUsers(filterInput.value);
  renderUsers(visible);

  statusEl.textContent =
    visible.length === 1
      ? "1 user matches your filter."
      : visible.length + " users match your filter.";
});