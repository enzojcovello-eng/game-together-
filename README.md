# Game Together 🎮

Chamada de voz (sem câmera) para encontrar gente para jogar junto.
Você escolhe o jogo, quantas pessoas quer na chamada, o idioma e a sua
plataforma, clica em **Matchmake** e cai numa chamada com quem escolheu a
mesma coisa. Funciona no PC e no celular, direto no navegador.

🇺🇸 [English version below](#game-together-english)

## Como funciona

1. Na tela inicial, clique no jogo.
2. Escolha o apelido, a quantidade de pessoas, o idioma e a plataforma.
3. Clique em **Matchmake**.
   - **2 pessoas**: você e mais 1. Fica procurando até aparecer alguém com a mesma escolha.
   - **3 ou mais**: você entra numa sala aberta (ou cria uma) e as pessoas vão entrando até o limite do jogo.
4. Na chamada: mute, sair, lista de quem está falando e um chat rápido de texto.

Você só cai com quem escolheu o mesmo jogo, o mesmo idioma, a mesma
quantidade de pessoas e uma plataforma compatível.

| Jogo | Limite na chamada | Plataformas | Crossplay |
|---|---|---|---|
| ARK: Survival Evolved | 5 | PC, PlayStation, Xbox, Switch, Celular | Não: cada plataforma só encontra a própria |
| ARK: Survival Ascended | 5 | PC, PlayStation, Xbox | Sim |
| Rocket League | 4 | PC, PlayStation, Xbox, Switch | Sim |
| Fortnite | 4 | PC, PlayStation, Xbox, Switch, Celular | Sim |
| Roblox | 5 | PC, PlayStation, Xbox, Celular | Sim |

Idiomas: Português (BR) e English (US). O idioma escolhido também traduz o site.

## Baixar e rodar no seu computador

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

1. Clique no botão verde **Code** aqui no GitHub e depois em **Download ZIP**
   (ou rode `git clone https://github.com/enzojcovello-eng/game-together-.git`).
2. Descompacte e abra a pasta no terminal.
3. Rode:

```bash
npm install
npm start
```

4. Abra `http://localhost:3000` no navegador.

Para testar sozinho, abra duas abas (ou uma normal e uma anônima) e faça a
mesma escolha nas duas.

Para usar no celular, o site precisa estar em um endereço `https://`
(o navegador do celular só libera o microfone assim). Pelo IP do computador
na rede de casa o microfone não funciona.

## Privacidade

O áudio vai direto entre os navegadores. O servidor só faz o encontro das
pessoas; ele não grava nem ouve a chamada. Nada fica salvo: ao fechar a aba
a pessoa sai da sala.

---

# Game Together (English)

Voice-only call (no camera) to find people to play with. Pick the game,
how many people you want on the call, your language and your platform,
hit **Matchmake** and you land on a call with people who picked the same.
Works on PC and phone, right in the browser.

## How it works

1. On the home screen, click the game.
2. Pick a nickname, how many people, the language and your platform.
3. Click **Matchmake**.
   - **2 people**: you and 1 more. It keeps searching until someone with the same choice shows up.
   - **3 or more**: you join an open room (or create one) and people keep joining until the game's limit.
4. On the call: mute, leave, a list of who is speaking and a quick text chat.

You only match people who picked the same game, the same language, the same
call size and a compatible platform.

| Game | Call limit | Platforms | Crossplay |
|---|---|---|---|
| ARK: Survival Evolved | 5 | PC, PlayStation, Xbox, Switch, Mobile | No: each platform only matches itself |
| ARK: Survival Ascended | 5 | PC, PlayStation, Xbox | Yes |
| Rocket League | 4 | PC, PlayStation, Xbox, Switch | Yes |
| Fortnite | 4 | PC, PlayStation, Xbox, Switch, Mobile | Yes |
| Roblox | 5 | PC, PlayStation, Xbox, Mobile | Yes |

Languages: Português (BR) and English (US). The language you pick also
translates the site.

## Download and run on your computer

You need [Node.js](https://nodejs.org) 18 or newer.

1. Click the green **Code** button here on GitHub, then **Download ZIP**
   (or run `git clone https://github.com/enzojcovello-eng/game-together-.git`).
2. Unzip it and open the folder in a terminal.
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000` in your browser.

To test alone, open two tabs (or a normal one and an incognito one) and make
the same choice in both.

To use it on a phone, the site must be on an `https://` address (phone
browsers only allow the microphone that way). Opening it through your
computer's IP on the home network will not enable the microphone.

## Privacy

Audio goes directly between browsers. The server only matches people; it
does not record or listen to the call. Nothing is stored: closing the tab
leaves the room.

## License

MIT
