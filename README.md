# Game Together 🎮

Chamada de voz (sem câmera) para encontrar gente para jogar junto.
Você escolhe o jogo, quantas pessoas quer na chamada, o idioma e a sua
plataforma, clica em **Matchmake** e cai numa chamada com quem escolheu a
mesma coisa. Funciona no PC, no Android e no iPhone, direto no navegador,
e dá para instalar como app.

🔗 **Link do site:** https://game-together.onrender.com

🇺🇸 [English version below](#game-together-english)

## Compartilhe e sugira jogos

O site só funciona se tiver gente. Quanto mais pessoas entrarem, mais
rápido todo mundo encontra alguém. Então manda o link para o máximo de
pessoas que puder: amigos, grupos, servidores de Discord, quem joga com
você.

Quer ver outro jogo aqui? Escreva nos comentários qual jogo quer que a gente
adicione (em português ou em inglês, tanto faz):
👉 [Sugerir um jogo](https://github.com/enzojcovello-eng/game-together-/issues/new?title=Sugest%C3%A3o%20de%20jogo%3A%20)

## Como acessar e instalar

Não tem download na loja. O app é o próprio site: você abre o link e, se
quiser, adiciona na tela inicial. Fica com ícone e abre em tela cheia, como
um app normal.

### Android

1. Abra o link no **Chrome**.
2. Toque nos três pontos (⋮) no canto superior direito.
3. Toque em **Instalar app** (ou **Adicionar à tela inicial**).
4. O ícone do Game Together aparece junto com os outros apps.

### iPhone e iPad

1. Abra o link no **Safari** (precisa ser o Safari, o Chrome do iPhone não instala).
2. Toque no botão de compartilhar (o quadrado com a seta para cima, embaixo no meio).
3. Role e toque em **Adicionar à Tela de Início**.
4. Toque em **Adicionar**. O ícone aparece na tela inicial.

Funciona no iOS 13.4 ou mais novo. Na primeira chamada o iPhone pede
permissão do microfone; toque em **Permitir**.

### PC (Windows, Mac ou Linux)

Abra o link no navegador e pronto. Para ter como app com ícone próprio:

- **Chrome ou Edge**: clique no ícone de instalar na barra de endereço
  (um monitor com uma seta) ou vá no menu ⋮ e em **Instalar Game Together**.
- **Firefox ou Safari**: use direto no navegador ou salve nos favoritos.

### ⏳ Se o site demorar para abrir

O servidor desliga sozinho depois de uns 15 minutos sem ninguém usando.
A primeira pessoa que abrir espera de **30 segundos a 1 minuto** até ele
ligar de novo. Depois disso abre na hora para todo mundo. Se ficar na tela
em branco, espere um pouco e recarregue.

## Como funciona

1. Na primeira vez, digite só o seu nome. Sem senha, sem e-mail. O nome é
   único e é como as pessoas vão te ver. Nas próximas vezes o app já abre
   no seu nome.
2. Na tela inicial, clique no jogo.
3. Escolha a quantidade de pessoas, o idioma e, se o jogo não tiver
   crossplay, a sua plataforma. Em jogo com crossplay não precisa escolher:
   você cai com gente de qualquer plataforma.
4. Clique em **Matchmake**.
   - **2 pessoas**: você e mais 1. Fica procurando até aparecer alguém com a mesma escolha.
   - **3 ou mais**: você entra numa sala aberta (ou cria uma) e as pessoas vão entrando até o limite do jogo.
5. Na chamada: mute, sair, lista de quem está falando e um chat rápido de texto.

Você só cai com quem escolheu o mesmo jogo, o mesmo idioma, a mesma
quantidade de pessoas e uma plataforma compatível.

| Jogo | Limite na chamada | Plataformas | Crossplay |
|---|---|---|---|
| ARK: Survival Evolved | 5 | PC, PlayStation, Xbox, Switch, Celular | Não: cada plataforma só encontra a própria |
| ARK: Survival Ascended | 5 | PC, PlayStation, Xbox | Sim |
| Rocket League | 4 | PC, PlayStation, Xbox, Switch | Sim |
| Fortnite | 4 | PC, PlayStation, Xbox, Switch, Celular | Sim |
| Roblox | 5 | PC, PlayStation, Xbox, Celular | Sim |
| Terraria | 5 | PC, PlayStation, Xbox, Switch, Celular | Não: cada plataforma só encontra a própria |

Idiomas: Português (BR) e English (US). O idioma escolhido também traduz o site.

### Sua conta fica em um aparelho por vez

A conta é o seu nome, guardada no aparelho em que você entrou. Se alguém
digitar o seu nome em outro aparelho, esse aparelho fica esperando e você
recebe um aviso no app: **Permitir** ou **Recusar**. Se não viu o aviso, o
pedido fica na aba **Logins**, dentro do botão de chat no topo. Ao permitir,
a conta passa para o outro aparelho e sai deste. Se você tocar em **Sair**,
o nome fica livre e entra direto no próximo aparelho. Uma conta parada há
mais de 7 dias também entra direto, para ninguém ficar trancado para fora.

## Rodar no seu próprio computador (opcional)

Só se você quiser ter uma cópia sua. Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

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
mesma escolha nas duas. Nessa cópia local o celular não consegue usar o
microfone, porque o navegador do celular só libera em endereço `https://`.

## Privacidade

O áudio vai direto entre os navegadores. O servidor só faz o encontro das
pessoas; ele não grava nem ouve a chamada. Da conta, o servidor guarda só o
nome e em qual aparelho ela está. Nada da chamada fica salvo: ao fechar o
app a pessoa sai da sala.

## Atualizações

O site atualiza sozinho: toda mudança aprovada aqui no GitHub vai para o ar
em poucos minutos. Quem estiver com o app aberto (ou instalado na tela
inicial) vê uma faixa amarela "Tem uma versão nova" com o botão
**Atualizar agora**. Quem roda uma cópia própria no computador vê a faixa
"Esta cópia do app está desatualizada" com o botão para baixar a versão
nova aqui no GitHub.

## Capas dos jogos

As capas que vêm no site são ilustrações próprias (as oficiais têm direitos
autorais). Para trocar por outra imagem não precisa mexer em código: é só
colocar o arquivo na pasta `public/covers/` com o nome do jogo e a extensão
`.jpg`, `.jpeg`, `.png` ou `.webp`. O app usa a imagem no lugar da
ilustração. Formato bom: vertical, 600 x 800 pixels ou maior.

| Jogo | Nome do arquivo |
|---|---|
| ARK: Survival Evolved | `ark-survival-evolved.jpg` |
| ARK: Survival Ascended | `ark-survival-ascended.jpg` |
| Rocket League | `rocket-league.jpg` |
| Fortnite | `fortnite.jpg` |
| Roblox | `roblox.jpg` |
| Terraria | `terraria.jpg` |

---

# Game Together (English)

Voice-only call (no camera) to find people to play with. Pick the game,
how many people you want on the call, your language and your platform,
hit **Matchmake** and you land on a call with people who picked the same.
Works on PC, Android and iPhone, right in the browser, and can be installed
as an app.

🔗 **Site link:** https://game-together.onrender.com

## Share it and suggest games

The site only works if there are people on it. The more people join, the
faster everyone finds someone. So send the link to as many people as you
can: friends, group chats, Discord servers, whoever you play with.

Want another game here? Write in the comments which game you want us to
add (in English or Portuguese, either is fine):
👉 [Suggest a game](https://github.com/enzojcovello-eng/game-together-/issues/new?title=Game%20suggestion%3A%20)

## How to access and install

There is no store download. The app is the site itself: open the link and,
if you want, add it to your home screen. It gets an icon and opens full
screen, like a regular app.

### Android

1. Open the link in **Chrome**.
2. Tap the three dots (⋮) in the top right corner.
3. Tap **Install app** (or **Add to Home screen**).
4. The Game Together icon shows up next to your other apps.

### iPhone and iPad

1. Open the link in **Safari** (it has to be Safari; Chrome on iPhone cannot install it).
2. Tap the share button (the square with an arrow pointing up, bottom center).
3. Scroll and tap **Add to Home Screen**.
4. Tap **Add**. The icon appears on your home screen.

Works on iOS 13.4 or newer. On the first call the iPhone asks for
microphone permission; tap **Allow**.

### PC (Windows, Mac or Linux)

Open the link in your browser and you are done. To have it as an app with
its own icon:

- **Chrome or Edge**: click the install icon in the address bar (a monitor
  with an arrow) or open the ⋮ menu and choose **Install Game Together**.
- **Firefox or Safari**: use it in the browser or bookmark it.

### ⏳ If the site takes a while to open

The server shuts down by itself after about 15 minutes with nobody using
it. The first person to open it waits **30 seconds to 1 minute** until it
starts again. After that it opens instantly for everyone. If you see a
blank screen, wait a bit and reload.

## How it works

1. The first time, just type your name. No password, no email. The name
   is unique and it is how people will see you. Next time the app opens
   already in your name.
2. On the home screen, click the game.
3. Pick how many people, the language and, if the game has no crossplay,
   your platform. Crossplay games skip that step: you match people on any
   platform.
4. Click **Matchmake**.
   - **2 people**: you and 1 more. It keeps searching until someone with the same choice shows up.
   - **3 or more**: you join an open room (or create one) and people keep joining until the game's limit.
5. On the call: mute, leave, a list of who is speaking and a quick text chat.

You only match people who picked the same game, the same language, the same
call size and a compatible platform.

| Game | Call limit | Platforms | Crossplay |
|---|---|---|---|
| ARK: Survival Evolved | 5 | PC, PlayStation, Xbox, Switch, Mobile | No: each platform only matches itself |
| ARK: Survival Ascended | 5 | PC, PlayStation, Xbox | Yes |
| Rocket League | 4 | PC, PlayStation, Xbox, Switch | Yes |
| Fortnite | 4 | PC, PlayStation, Xbox, Switch, Mobile | Yes |
| Roblox | 5 | PC, PlayStation, Xbox, Mobile | Yes |
| Terraria | 5 | PC, PlayStation, Xbox, Switch, Mobile | No: each platform only matches itself |

Languages: Português (BR) and English (US). The language you pick also
translates the site.

### Your account lives on one device at a time

The account is your name, kept on the device you entered from. If someone
types your name on another device, that device waits and you get a notice
in the app: **Allow** or **Deny**. If you missed the notice, the request
stays in the **Logins** tab, inside the chat button at the top. When you
allow it, the account moves to the other device and leaves this one. If
you tap **Log out**, the name is free and enters directly on the next
device. An account unused for more than 7 days also enters directly, so
nobody gets locked out.

## Run on your own computer (optional)

Only if you want your own copy. You need [Node.js](https://nodejs.org) 18 or newer.

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
the same choice in both. In this local copy, phones cannot use the
microphone, because phone browsers only allow it on an `https://` address.

## Privacy

Audio goes directly between browsers. The server only matches people; it
does not record or listen to the call. For your account it stores only the
name and which device holds it. Nothing from the call is stored: closing
the app leaves the room.

## Updates

The site updates by itself: every change approved here on GitHub goes live
in a few minutes. Anyone with the app open (or installed on the home
screen) sees a yellow bar "There is a new version" with an **Update now**
button. Anyone running their own copy on a computer sees "This copy of the
app is outdated" with a button to download the new version here on GitHub.

## Game covers

The covers that ship with the site are original illustrations (official
ones are copyrighted). To swap in another image you do not need to touch
code: just put the file in the `public/covers/` folder named after the game
with a `.jpg`, `.jpeg`, `.png` or `.webp` extension. The app uses the image
instead of the illustration. Good format: portrait, 600 x 800 pixels or
larger.

| Game | File name |
|---|---|
| ARK: Survival Evolved | `ark-survival-evolved.jpg` |
| ARK: Survival Ascended | `ark-survival-ascended.jpg` |
| Rocket League | `rocket-league.jpg` |
| Fortnite | `fortnite.jpg` |
| Roblox | `roblox.jpg` |
| Terraria | `terraria.jpg` |

## License

MIT
