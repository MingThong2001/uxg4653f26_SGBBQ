import { createClient } from
  "https://esm.sh/@supabase/supabase-js@2";

// Replace these with your own Supabase details.
const SUPABASE_URL =   "https://xatgzoturyuygtgukegt.supabase.co";

const SUPABASE_KEY = "sb_publishable_k6u5Nka26BQpQOP4R1H6Zw_lJ4PBUpT";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

async function loadPits() {
  const status = document.getElementById("status");
  const pitList = document.getElementById("pit-list");

  const { data, error } = await supabase
    .from("bbq_pits")
    .select("name, location");

  if (error) {
    status.textContent =
      "Unable to load BBQ pits. Check your database setup.";
    console.error(error);
    return;
  }

  status.textContent = `${data.length} BBQ pits found`;

  if (data.length === 0) {
    status.textContent = "No BBQ pits have been added yet.";
    return;
  }

  pitList.innerHTML = "";

  data.forEach((pit) => {
    const card = document.createElement("article");
    card.className = "pit-card";

    const name = document.createElement("h3");
    name.textContent = pit.name;

    const location = document.createElement("p");
    location.textContent = pit.location || "Location not provided";

    card.append(name, location);
    pitList.appendChild(card);
  });
}

loadPits();