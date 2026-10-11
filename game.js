
(() => {
  "use strict";

  const WIDTH = 360;
  const HEIGHT = 600;
  const LANES = [112, 180, 248];
  const STORAGE_KEY = "pixelGPRankingsByName";

  const $ = id => document.getElementById(id);
  const message = $("message");
  const nameInput = $("playerName");

  let playerName = "";
  let raceScene = null;
  let startQueued = false;

  // İsimlerde Türkçe dahil bütün normal harflere izin ver.
  function cleanName(value) {
    return String(value || "")
      .normalize("NFC")
      .trim()
      .replace(/[.#$/\[\]]/g, "")
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/\s+/g, " ")
      .slice(0, 15);
  }

  // Yerel puan tablosunu oku.
  function readScores() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  // Her oyuncu için yalnızca en yüksek puanı tut.
  function saveScore(name, score) {
    const normalizedName = cleanName(name);
    if (!normalizedName) return;

    const scores = readScores();
    scores[normalizedName] = Math.max(
      Number(scores[normalizedName] || 0),
      Math.floor(score)
    );

    localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
    renderScores();
  }

  function renderScores() {
    const list = $("scores");
    list.replaceChildren();

    const rows = Object.entries(readScores())
      .map(([name, score]) => ({
        name,
        score: Number(score) || 0
      }))
      .sort((a, b) => b.score - a.score ||
        a.name.localeCompare(b.name))
      .slice(0, 10);

    if (!rows.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "Your best score will appear here.";
      list.appendChild(empty);
      return;
    }

    rows.forEach((row, index) => {
      const item = document.createElement("li");
      item.className = "score-row";

      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(index + 1).padStart(2, "0");

      const name = document.createElement("span");
      name.className = "player";
      name.textContent = row.name;

      const points = document.createElement("span");
      points.className = "points";
      points.textContent = row.score.toLocaleString();

      item.append(rank, name, points);
      list.appendChild(item);
    });
  }

  class RaceScene extends Phaser.Scene {
    constructor() {
      super("race");
    }

    create() {
      raceScene = this;

      this.elapsed = 0;
      this.score = 0;
      this.speed = 300;
      this.spawnTimer = 0;
      this.started = false;
      this.gameOver = false;
      this.playerLane = 1;
      this.traffic = [];
      this.roadMarks = [];
      this.scenery = [];

      // enableCapture=false: A/D harfleri tarayıcıdan çalınmaz, isim kutusuna yazılabilir.
      this.keys = this.input.keyboard.addKeys(
        "LEFT,RIGHT,A,D", false
      );
      this.carTextures = [];
      this.restartLock = 0;

      this.drawTrack();
      this.makeCarTexture("player", 0xff7a1a, 0xffffff, true);

      this.player = this.add.image(
        LANES[1], 490, "player"
      ).setDepth(5);

      this.hud = this.add.text(
        10, 9, "SCORE 00000",
        {
          fontFamily: "monospace",
          fontSize: "14px",
          color: "#ffffff",
          stroke: "#102019",
          strokeThickness: 4
        }
      ).setDepth(20);

      this.speedText = this.add.text(
        WIDTH - 10, 9, "000 KM/H",
        {
          fontFamily: "monospace",
          fontSize: "14px",
          color: "#ffb347",
          stroke: "#102019",
          strokeThickness: 4
        }
      ).setOrigin(1, 0).setDepth(20);

      // Hollanda bayrağı şeridi
      [0xae1c28, 0xffffff, 0x21468b].forEach((c, i) =>
        this.add.rectangle(i * 120, 0, 120, 5, c)
          .setOrigin(0).setDepth(19));

      this.overlay = this.add.container(0, 0).setDepth(30);
      this.showOverlay("READY?", "Tap START RACE");

      if (startQueued) this.startRace();

      this.input.on("pointerdown", pointer => {
        if (!this.started && !this.gameOver) {
          this.startRace();
        } else if (this.started && !this.gameOver) {
          this.moveLane(pointer.x < WIDTH / 2 ? -1 : 1);
        } else if (this.gameOver && this.time.now > this.restartLock) {
          this.startRace();
        }
      });
    }

    drawTrack() {
      const mk = () => this.make.graphics({ x: 0, y: 0, add: false });
      const g = this.add.graphics();

      // Zemin + asfalt
      g.fillStyle(0x2e7d3a).fillRect(0, 0, WIDTH, HEIGHT);
      g.fillStyle(0x41464b).fillRect(80, 0, 200, HEIGHT);
      g.fillStyle(0x2f3338);
      g.fillRect(80, 0, 3, HEIGHT);
      g.fillRect(277, 0, 3, HEIGHT);

      // Lale tarlası dokusu (renkli bant bant, Hollanda bahçeleri gibi)
      const field = mk();
      field.fillStyle(0x2e7d3a).fillRect(0, 0, 72, 64);
      [0xe63946, 0xffd166, 0xff8fb3, 0xff7a1a].forEach((color, i) => {
        const y = i * 16;
        field.fillStyle(color).fillRect(0, y + 2, 72, 9);
        field.fillStyle(0x000000, 0.18);
        for (let x = 2; x < 72; x += 6) field.fillRect(x, y + 5, 2, 3);
        field.fillStyle(0x1f5f2b).fillRect(0, y + 11, 72, 3);
      });
      field.generateTexture("field", 72, 64);
      field.destroy();

      // Kırmızı-beyaz yarış kerbi
      const curb = mk();
      curb.fillStyle(0xd62828).fillRect(0, 0, 8, 16);
      curb.fillStyle(0xf6f0d7).fillRect(0, 16, 8, 16);
      curb.generateTexture("curb", 8, 32);
      curb.destroy();

      this.ground = [
        this.add.tileSprite(0, 0, 72, HEIGHT, "field").setOrigin(0),
        this.add.tileSprite(288, 0, 72, HEIGHT, "field").setOrigin(0),
        this.add.tileSprite(72, 0, 8, HEIGHT, "curb").setOrigin(0),
        this.add.tileSprite(280, 0, 8, HEIGHT, "curb").setOrigin(0)
      ];

      for (let y = -40; y < HEIGHT + 40; y += 72) {
        this.roadMarks.push(
          this.add.rectangle(147, y, 4, 34, 0xf4e6a1),
          this.add.rectangle(213, y + 36, 4, 34, 0xf4e6a1)
        );
      }

      // Yel değirmeni gövdesi: aşağı doğru GENİŞLEYEN gövde, tepede kırmızı çatı
      const mill = mk();
      mill.fillStyle(0x1f5f2b).fillEllipse(20, 53, 38, 8);
      for (let y = 14; y < 52; y += 2) {
        const w = Math.round(14 + (y - 14) * 0.38);
        mill.fillStyle(y % 8 < 4 ? 0xf0e2bd : 0xe0cfa0)
          .fillRect(Math.round(20 - w / 2), y, w, 2);
      }
      mill.fillStyle(0x72513b).fillRect(7, 46, 26, 6);
      mill.fillStyle(0x3d2a24).fillRect(17, 40, 6, 8);
      mill.fillStyle(0x3b6ea5).fillRect(18, 26, 4, 5);
      mill.fillStyle(0x9c3b2a).fillRect(11, 8, 18, 7);
      mill.fillStyle(0x7b2d20).fillRect(14, 4, 12, 5);
      mill.fillRect(17, 1, 6, 4);
      mill.generateTexture("millBase", 40, 56);
      mill.destroy();

      // Kanatlar
      const blades = mk();
      blades.fillStyle(0x7a4a2f);
      blades.fillRect(18, 0, 4, 40);
      blades.fillRect(0, 18, 40, 4);
      blades.fillStyle(0xf3efe0);
      blades.fillRect(23, 2, 7, 15);
      blades.fillRect(23, 23, 15, 7);
      blades.fillRect(10, 23, 7, 15);
      blades.fillRect(2, 10, 15, 7);
      blades.fillStyle(0x7a4a2f).fillRect(16, 16, 8, 8);
      blades.generateTexture("millBlades", 40, 40);
      blades.destroy();

      // Her iki yanda eşit aralıklı yel değirmenleri
      for (let i = 0; i < 4; i++) {
        this.addMill(36, -55 + i * 179);
        this.addMill(324, 34 + i * 179);
      }
    }

    addMill(x, y) {
      const base = this.add.image(x, y, "millBase")
        .setScale(1.2).setDepth(2);
      const blades = this.add.image(x, y - 17, "millBlades")
        .setScale(1.25).setDepth(3);
      this.scenery.push({ base, blades });
    }

    // Üstten görünüşlü F1 aracı (burun yukarıda)
    makeCarTexture(key, body, accent, dutch) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const dark = 0x101418;

      // Ön kanat
      g.fillStyle(accent).fillRect(3, 1, 28, 4);
      g.fillStyle(dark).fillRect(3, 0, 2, 6).fillRect(29, 0, 2, 6);
      // Burun ve gövde
      g.fillStyle(body).fillRect(14, 5, 6, 14);
      g.fillRect(10, 18, 14, 20);
      // Süspansiyon kolları
      g.fillStyle(dark).fillRect(9, 13, 5, 2).fillRect(20, 13, 5, 2);
      g.fillRect(9, 36, 16, 3);
      // Tekerlekler
      g.fillRect(2, 9, 7, 11).fillRect(25, 9, 7, 11);
      g.fillRect(1, 31, 8, 13).fillRect(25, 31, 8, 13);
      // Kokpit, kask, hava girişi
      g.fillRect(14, 20, 6, 8);
      g.fillStyle(accent).fillRect(15, 22, 4, 4);
      g.fillRect(16, 29, 2, 9);
      // Arka kanat
      if (dutch) {
        g.fillStyle(0xae1c28).fillRect(5, 43, 8, 4);
        g.fillStyle(0xffffff).fillRect(13, 43, 8, 4);
        g.fillStyle(0x21468b).fillRect(21, 43, 8, 4);
      } else {
        g.fillStyle(accent).fillRect(5, 43, 24, 4);
      }
      g.fillStyle(dark).fillRect(4, 41, 2, 7).fillRect(28, 41, 2, 7);

      g.generateTexture(key, 34, 48);
      g.destroy();
    }

    showOverlay(title, subtitle) {
      this.overlay.removeAll(true);

      const shade = this.add.rectangle(
        WIDTH / 2, HEIGHT / 2,
        WIDTH, HEIGHT, 0x07110d, 0.72
      );

      const heading = this.add.text(
        WIDTH / 2, HEIGHT / 2 - 20, title,
        {
          fontFamily: "monospace",
          fontSize: "26px",
          fontStyle: "bold",
          color: "#ffda6a",
          stroke: "#102019",
          strokeThickness: 5
        }
      ).setOrigin(0.5);

      const sub = this.add.text(
        WIDTH / 2, HEIGHT / 2 + 18, subtitle,
        {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#ffffff",
          align: "center",
          wordWrap: { width: 290 }
        }
      ).setOrigin(0.5);

      this.overlay.add([shade, heading, sub]);
    }

    startRace() {
      if (!playerName) {
        message.textContent = "Enter a player name first.";
        return;
      }

      this.started = true;
      this.gameOver = false;
      this.elapsed = 0;
      this.score = 0;
      this.speed = 300;
      this.spawnTimer = 0;
      this.playerLane = 1;
      this.player.setPosition(LANES[1], 490).setVisible(true);

      this.traffic.forEach(car => car.destroy());
      this.traffic = [];
      this.overlay.removeAll(true);

      message.textContent = "GO! Dodge the traffic!";
    }

    moveLane(direction) {
      if (!this.started || this.gameOver) return;

      this.playerLane = Phaser.Math.Clamp(
        this.playerLane + direction, 0, 2
      );

      this.player.x = LANES[this.playerLane];
    }

    spawnTraffic() {
      // Bazen iki araç çıkar; bir şerit boş kalır.
      const pair = this.elapsed > 3 &&
        Math.random() < Math.min(0.7, 0.25 + this.elapsed / 70);

      let lanes;

      if (pair) {
        const openLane = Phaser.Math.Between(0, 2);
        lanes = [0, 1, 2].filter(lane => lane !== openLane);
      } else {
        lanes = [Phaser.Math.Between(0, 2)];
      }

      const colors = [
        [0x1b2a6b, 0xe63946],
        [0xd62828, 0xffffff],
        [0xc9d1d9, 0x00d2be],
        [0x2f6bff, 0xffffff],
        [0x0b6e4f, 0xf4cf42],
        [0xff6fb5, 0x20252a]
      ];

      lanes.forEach((lane, index) => {
        const chosen = Phaser.Utils.Array.GetRandom(colors);
        const ci = colors.indexOf(chosen);
        const key = "traffic_" + ci;

        if (!this.textures.exists(key)) {
          this.makeCarTexture(key, chosen[0], chosen[1]);
        }

        const car = this.add.image(
          LANES[lane], -45 - index * 58, key
        ).setDepth(4);

        car.rivalSpeed = Phaser.Math.Between(60, 130);
        this.traffic.push(car);
      });
    }

    endRace() {
      if (this.gameOver) return;

      this.gameOver = true;
      this.started = false;
      this.restartLock = this.time.now + 700;

      const finalScore = Math.floor(this.score);
      saveScore(playerName, finalScore);

      this.showOverlay(
        "RACE OVER",
        playerName + "\nSCORE " + finalScore +
        "\nTap START RACE to try again"
      );

      message.textContent =
        playerName + ": " + finalScore +
        " points. Your best score is saved.";
    }

    update(_, delta) {
      if (!this.started || this.gameOver) return;

      const dt = delta / 1000;
      this.elapsed += dt;

      // Yarış ilerledikçe hız artar.
      this.speed = Math.min(680, 300 + this.elapsed * 10);
      this.score += dt * this.speed / 5;

      this.hud.setText(
        "SCORE " + String(Math.floor(this.score)).padStart(5, "0")
      );

      const typing = document.activeElement === nameInput;

      if (typing) {
        // yazarken tuşlar araca gitmesin
      } else if (
        Phaser.Input.Keyboard.JustDown(this.keys.LEFT) ||
        Phaser.Input.Keyboard.JustDown(this.keys.A)
      ) this.moveLane(-1);

      if (typing) {
        // yazarken tuşlar araca gitmesin
      } else if (
        Phaser.Input.Keyboard.JustDown(this.keys.RIGHT) ||
        Phaser.Input.Keyboard.JustDown(this.keys.D)
      ) this.moveLane(1);

      this.speedText.setText(
        String(Math.round(this.speed * 0.65)).padStart(3, "0") + " KM/H"
      );

      this.roadMarks.forEach(mark => {
        mark.y += this.speed * dt;
        if (mark.y > HEIGHT + 35) mark.y -= HEIGHT + 108;
      });

      this.ground.forEach(t => { t.tilePositionY -= this.speed * dt; });

      this.scenery.forEach(item => {
        item.base.y += this.speed * dt;
        item.blades.x = item.base.x;
        item.blades.y = item.base.y - 17;
        item.blades.rotation += dt * 2.4;
        if (item.base.y > HEIGHT + 60) item.base.y -= 716;
      });

      this.spawnTimer += delta;

      const interval = Math.max(
        300, 800 - this.elapsed * 14
      );

      if (this.spawnTimer >= interval) {
        this.spawnTimer = 0;
        this.spawnTraffic();
      }

      for (let i = this.traffic.length - 1; i >= 0; i--) {
        const car = this.traffic[i];
        car.y += (this.speed - car.rivalSpeed) * dt;

        if (
          Math.abs(car.x - this.player.x) < 24 &&
          Math.abs(car.y - this.player.y) < 40
        ) {
          this.endRace();
          return;
        }

        if (car.y > HEIGHT + 60) {
          car.destroy();
          this.traffic.splice(i, 1);
        }
      }
    }
  }

  function startFromForm() {
    playerName = cleanName(nameInput.value);

    if (!playerName) {
      message.textContent = "Please enter a name (up to 15 characters).";
      nameInput.focus();
      return;
    }

    nameInput.value = playerName;
    nameInput.blur();

    if (!raceScene) {
      startQueued = true;
      message.textContent = "Getting the track ready…";
      return;
    }

    raceScene.startRace();
  }

  $("startButton").addEventListener("click", startFromForm);

  nameInput.addEventListener("keydown", event => {
    if (event.key === "Enter") startFromForm();
  });

  $("leftButton").addEventListener("pointerdown", event => {
    event.preventDefault();
    if (raceScene) raceScene.moveLane(-1);
  });

  $("rightButton").addEventListener("pointerdown", event => {
    event.preventDefault();
    if (raceScene) raceScene.moveLane(1);
  });

  const resetBtn = $("refreshButton");
  let resetTimer = null;

  // Yanlışlıkla silinmesin: önce "SURE?" çıkar, 3 saniye içinde tekrar basılırsa siler.
  resetBtn.addEventListener("click", () => {
    if (resetBtn.dataset.armed !== "1") {
      resetBtn.dataset.armed = "1";
      resetBtn.textContent = "SURE?";
      message.textContent = "Tap RESET again to delete ALL scores.";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        resetBtn.dataset.armed = "0";
        resetBtn.textContent = "RESET";
      }, 3000);
      return;
    }

    clearTimeout(resetTimer);
    resetBtn.dataset.armed = "0";
    resetBtn.textContent = "RESET";

    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    renderScores();
    message.textContent = "Scoreboard cleared. Fresh start!";
  });
  window.addEventListener("storage", renderScores);

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: "#286342",
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [RaceScene]
  });

  renderScores();
})();