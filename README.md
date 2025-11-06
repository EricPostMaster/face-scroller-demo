# face-scroller-demo

I thought it would be fun to make a game that you control with your face. This is the initial prototype. It's janky, but it works. That said, the logic is basic, so it may create impossible scenarios at times 😅. PRs welcome!

## How to play 🎮

- Visit [https://ericpostmaster.github.io/face-scroller-demo/](https://ericpostmaster.github.io/face-scroller-demo/) 🖥️
- Allow camera access when the browser asks. 📷
- Tip your head back to jump 🦘
- Open your mouth to trigger a shield 🛡️
- Avoid obstacles and try to survive as long as you can! 💥

Tips:
- Good lighting and a steady background help the tracker perform better. 💡
- At the top center of the screen, the dotted blue line shows the threshold at which your character will jump. If the red dot goes above that line, your character will jump.

## Ideas
- Power up that lets the player "flap wings" after jumping by alternating closing eyes
- What ideas could use more head/face movements?


## High Score Board

- A Top 5 score board appears to the right of the game. When you finish a run and your score is good enough for the Top 5, you'll be prompted to enter your name. Scores are saved to localStorage so they'll persist in your browser.
- To clear saved scores, click the "Reset Scores" button in the scoreboard and confirm.


## How it works ⚙️

- The demo uses your webcam feed and a lightweight face-tracking approach (browser-based JS) to estimate where your face is in the frame. The detected position is mapped to the player's movement on screen. 🕵️‍♂️➡️🕹️
- `script.js` contains a simple game loop: it updates entities, moves the background/obstacles, checks for collisions, and renders the scene each frame. 🔁
- This is a prototype — the detection, mapping, and physics are intentionally simple so the code is easy to read and tweak. If you want to improve accuracy or features, the code is a good starting point. 🚀

## Contributing & notes 💡

- Want to help? Add features, improve tracking, or polish the UX — PRs are very welcome. 🙌
- If you report issues, include browser and OS details and a short description of your camera setup (lighting, webcam model). That helps reproduce tracking quirks. 🔎

Have fun and try not to laugh at how silly this feels! 😄
