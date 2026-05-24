const express = require("express");
const puppeteer = require("puppeteer");
const path = require("path");

const app = express();

let browser, page;

// 🚀 START BROWSER
async function startBrowser() {
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });

  page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });

  await page.goto(
    "https://www.polycet.sbtet.telangana.gov.in/#!/index/GetRankCard",
    { waitUntil: "networkidle2" }
  );

  console.log("✅ Browser started");
}

startBrowser();

app.use(express.json());
app.use(express.static("public"));


// 🏠 HOME
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});


// 🔥 CAPTCHA (HYBRID METHOD)
app.get("/captcha", async (req, res) => {
  try {
    await page.goto(
      "https://www.polycet.sbtet.telangana.gov.in/#!/index/GetRankCard",
      { waitUntil: "networkidle2" }
    );

    // 🔥 WAIT MORE (IMPORTANT)
    await new Promise(r => setTimeout(r, 3000));

    // =========================
    // 🔴 METHOD 1: OLD (FAST)
    // =========================
    const images = await page.$$("img");

    let target = null;

    for (let img of images) {
      try {
        const box = await img.boundingBox();

        if (
          box &&
          box.width > 120 &&
          box.width < 200 &&
          box.height > 30 &&
          box.height < 100
        ) {
          target = img;
          break;
        }
      } catch {}
    }

    // ✅ IF FOUND → RETURN
    if (target) {
      const buffer = await target.screenshot();
      res.set("Content-Type", "image/png");
      return res.send(buffer);
    }

    // =========================
    // 🔥 METHOD 2: BACKUP (CROP)
    // =========================
    console.log("Using fallback crop method...");

    const clipArea = {
      x: 670,
      y: 450,
      width: 130,
      height: 60
    };

    const captchaImage = await page.screenshot({ clip: clipArea });

    res.set("Content-Type", "image/png");
    res.send(captchaImage);

  } catch (err) {
    console.log("Captcha error:", err);
    res.json({ message: "Captcha error ❌" });
  }
});


// 🔥 RESULT
app.post("/result", async (req, res) => {
  const { hallticket, captcha } = req.body;

  if (!hallticket || !captcha) {
    return res.json({ message: "Enter all fields ❗" });
  }

  try {
    let alertMessage = null;

    await page.bringToFront();

    await page.waitForSelector("input[ng-model='HallTicketNumber']", { timeout: 10000 });
    await page.waitForSelector("input[placeholder='Enter Captcha']", { timeout: 10000 });

    // 🔥 HANDLE ALERT
    const dialogHandler = async (dialog) => {
      alertMessage = dialog.message();
      await dialog.dismiss();
    };

    page.on("dialog", dialogHandler);

    // CLEAR INPUTS
    await page.evaluate(() => {
      const ht = document.querySelector("input[ng-model='HallTicketNumber']");
      const cap = document.querySelector("input[placeholder='Enter Captcha']");
      if (ht) ht.value = "";
      if (cap) cap.value = "";
    });

    // TYPE VALUES
    await page.type("input[ng-model='HallTicketNumber']", hallticket);
    await page.type("input[placeholder='Enter Captcha']", captcha);

    // CLICK SUBMIT
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")]
        .find(b => b.innerText.includes("Submit"));
      if (btn) btn.click();
    });

    await new Promise(r => setTimeout(r, 2500));

    page.off("dialog", dialogHandler);

    // HANDLE ERRORS
    if (alertMessage) {
      if (alertMessage.toLowerCase().includes("captcha")) {
        return res.json({ message: "Invalid Captcha ❌" });
      }
      if (alertMessage.toLowerCase().includes("hallticket")) {
        return res.json({ message: "Hallticket Not Found ❌" });
      }
      return res.json({ message: alertMessage });
    }

    // GET RESULT
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
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});