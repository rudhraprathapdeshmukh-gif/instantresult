const express = require("express");
const puppeteer = require("puppeteer");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static("public"));

let browser;
let page;

// 🚀 START BROWSER
(async () => {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"]
  });

  page = await browser.newPage();

  await page.goto(
    "https://www.polycet.sbtet.telangana.gov.in/#!/index/GetRankCard",
    { waitUntil: "networkidle2" }
  );
})();


// HOME
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});


// 🔥 CAPTCHA (FIXED REFRESH)
app.get("/captcha", async (req, res) => {
  try {

    // 🔥 RELOAD PAGE (THIS IS THE REAL FIX)
    await page.goto(
      "https://www.polycet.sbtet.telangana.gov.in/#!/index/GetRankCard",
      { waitUntil: "networkidle2" }
    );

    // 🔥 WAIT FOR CAPTCHA TO LOAD
    await page.waitForSelector("img", { timeout: 10000 });

    await new Promise(r => setTimeout(r, 1500));

    const images = await page.$$("img");

    let target = null;

    for (let img of images) {
      try {
        const box = await img.boundingBox();

        // 👉 captcha size filter (correct)
        if (box && box.width > 120 && box.width < 200 && box.height < 80) {
          target = img;
          break;
        }

      } catch {}
    }

    if (!target) {
      return res.json({ message: "Captcha not found ❌" });
    }

    const buffer = await target.screenshot();

    res.set("Content-Type", "image/png");
    res.send(buffer);

  } catch (err) {
    console.log("Captcha error:", err);
    res.json({ message: "Captcha error ❌" });
  }
});


// 🔥 RESULT (FULLY FIXED)
app.post("/result", async (req, res) => {
  const { hallticket, captcha } = req.body;

  if (!hallticket || !captcha) {
    return res.json({ message: "Enter all fields ❗" });
  }

  try {
    let alertMessage = null;

    // 🔥 bring page to front
    await page.bringToFront();

    // 🔥 wait for inputs (FIX FOR NULL ERROR)
    await page.waitForSelector("input[ng-model='HallTicketNumber']", { timeout: 10000 });
    await page.waitForSelector("input[placeholder='Enter Captcha']", { timeout: 10000 });

    await new Promise(r => setTimeout(r, 500));

    // 🔥 handle alert
    const dialogHandler = async (dialog) => {
      try {
        alertMessage = dialog.message();
        await dialog.dismiss();
      } catch {}
    };

    page.on("dialog", dialogHandler);

    // 🔥 clear inputs safely
    await page.evaluate(() => {
      const ht = document.querySelector("input[ng-model='HallTicketNumber']");
      const cap = document.querySelector("input[placeholder='Enter Captcha']");

      if (ht) ht.value = "";
      if (cap) cap.value = "";
    });

    // 🔥 type values
    await page.type("input[ng-model='HallTicketNumber']", hallticket);
    await page.type("input[placeholder='Enter Captcha']", captcha);

    // 🔥 submit
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")]
        .find(b => b.innerText.includes("Submit"));
      if (btn) btn.click();
    });

    await new Promise(r => setTimeout(r, 2000));

    page.off("dialog", dialogHandler);

    // 🔴 HANDLE ERRORS
    if (alertMessage) {
      if (alertMessage.toLowerCase().includes("captcha")) {
        return res.json({ message: "Invalid Captcha ❌" });
      }

      if (alertMessage.toLowerCase().includes("hallticket")) {
        return res.json({ message: "Hallticket Number Not Found ❌" });
      }

      return res.json({ message: alertMessage });
    }

    // 🔥 WAIT FOR RESULT
    await page.waitForSelector("table", { timeout: 10000 });

    const data = await page.evaluate(() => {
      const container = [...document.querySelectorAll("div")]
        .find(d => d.innerText.includes("Hall Ticket"));

      if (!container) return null;

      const lines = container.innerText.split("\n");

      function get(label) {
        const line = lines.find(l => l.startsWith(label));
        return line ? line.split(":")[1]?.trim() : "";
      }

      const rows = container.querySelectorAll("table tr");

      let marks = [];

      rows.forEach((row, i) => {
        if (i === 0) return;

        const td = row.querySelectorAll("td");

        if (td.length >= 7) {
          marks.push({
            stream: td[0].innerText,
            maths: td[1].innerText,
            physics: td[2].innerText,
            chemistry: td[3].innerText,
            biology: td[4].innerText,
            total: td[5].innerText,
            rank: td[6].innerText
          });
        }
      });

      return {
        hallticket: get("TG POLYCET Hall Ticket No"),
        name: get("Name"),
        father: get("Father"),
        date: get("Date of Examination"),
        marks
      };
    });

    if (!data || !data.name) {
      return res.json({ message: "Failed to fetch result ❌" });
    }

    return res.json({ data });

  } catch (err) {
    console.log("Error:", err);
    return res.json({ message: "Try again ❌" });
  }
});


// 🚀 START SERVER
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});