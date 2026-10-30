# Game Together 🎮

Site de chamadas de voz (sem câmera) para encontrar gente para jogar junto.
Você escolhe o jogo, a quantidade de pessoas na chamada, o idioma e a sua
plataforma, clica em **Matchmake** e cai numa chamada com quem escolheu a
mesma coisa. Funciona no PC e no celular, direto no navegador.

*English: voice-only call site to find people to play with. Pick the game,
how many people you want on the call, your language and platform, hit
**Matchmake** and you land on a call with people who picked the same.
Works on PC and phone, in the browser. Setup steps are the same as below.*

## Como funciona

1. Na tela inicial, clique no jogo.
2. Escolha o apelido, a quantidade de pessoas, o idioma e a plataforma.
3. Clique em **Matchmake**.
   - **2 pessoas**: você e mais 1. Fica procurando até aparecer alguém com a mesma escolha.
   - **3 ou mais**: você entra numa sala aberta (ou cria uma) e as pessoas vão entrando até o limite do jogo.
4. Na chamada: mute, sair, lista de quem está falando e um chat rápido de texto.

O matchmaking só junta pessoas com o mesmo **jogo + idioma + grupo de plataforma + modo**.

| Jogo | Limite na chamada | Plataformas | Crossplay |
|---|---|---|---|
| ARK: Survival Evolved | 5 | PC, PlayStation, Xbox, Switch, Celular | Não: cada plataforma só encontra a própria |
| ARK: Survival Ascended | 5 | PC, PlayStation, Xbox | Sim |
| Rocket League | 4 | PC, PlayStation, Xbox, Switch | Sim |
| Fortnite | 4 | PC, PlayStation, Xbox, Switch, Celular | Sim |
| Roblox | 5 | PC, PlayStation, Xbox, Celular | Sim |

Idiomas: Português (BR) e English (US). O idioma escolhido também traduz a interface.

## Baixar e rodar

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

```bash
# 1. baixe o projeto (ou use o botão "Code > Download ZIP" no GitHub e descompacte)
git clone https://github.com/enzojcovello-eng/game-together-.git
cd game-together-

# 2. instale as dependências
npm install

# 3. suba o servidor
npm start
```

Abra `http://localhost:3000` no navegador. Para testar o matchmaking sozinho,
abra duas abas (ou uma aba normal e uma anônima) e faça a mesma escolha nas duas.

### Celular na mesma rede

O navegador do celular só libera o microfone em **HTTPS** ou em `localhost`.
Se abrir pelo IP do PC (`http://192.168.x.x:3000`) o microfone não funciona.
Opções:

- **Túnel HTTPS** (mais fácil): rode `npx localtunnel --port 3000` ou use o
  [ngrok](https://ngrok.com) (`ngrok http 3000`) e abra o endereço `https://...`
  que ele mostrar, no PC e no celular.
- **Certificado próprio**: gere um certificado (por exemplo com
  [mkcert](https://github.com/FiloSottile/mkcert)) e suba com
  `SSL_KEY=caminho/chave.pem SSL_CERT=caminho/cert.pem npm start`.

### Colocar na internet

O site precisa de um servidor Node rodando (o GitHub Pages sozinho não serve,
porque ele só hospeda arquivos estáticos). Qualquer host de Node funciona, por
exemplo [Render](https://render.com), [Railway](https://railway.app),
[Fly.io](https://fly.io) ou [Glitch](https://glitch.com):

- comando de build: `npm install`
- comando de start: `npm start` (já tem `Procfile`)
- a porta vem da variável `PORT`, que esses serviços definem sozinhos
- eles já entregam HTTPS, então o microfone funciona no celular sem configurar nada

Se muita gente estiver atrás de redes restritas (CGNAT, firewall de empresa)
pode ser preciso um servidor TURN. Troque a lista `ICE_SERVERS` em
`public/js/app.js` pelo seu (por exemplo um servidor coturn, ou um serviço
como Metered ou Twilio).

## Adicionar jogos

Edite `games.json`. Cada jogo tem:

```json
{
  "id": "minecraft",
  "name": "Minecraft",
  "short": "Minecraft",
  "emoji": "⛏️",
  "color": "#558b2f",
  "maxPlayers": 5,
  "platforms": ["pc", "playstation", "xbox", "switch", "mobile"],
  "crossplayGroups": [["playstation", "xbox", "switch", "mobile"]]
}
```

- `crossplay: true` junta todas as plataformas da lista.
- `crossplay: false` isola cada plataforma (como no ARK: Survival Evolved).
- `crossplayGroups` cria grupos parciais: no exemplo acima, console e celular
  (Bedrock) jogam juntos e o PC (Java) fica sozinho. Plataformas fora de todos
  os grupos ficam isoladas.

Plataformas e idiomas também ficam em `games.json`. Os textos da interface
ficam em `public/js/i18n.js`.

## Estrutura

```
server.js            servidor Express + Socket.IO (matchmaking e sinalização WebRTC)
lib/matchmaker.js    regras de fila, salas e limites
games.json           jogos, limites, plataformas e idiomas
public/index.html    interface (tela inicial, configuração, busca e chamada)
public/css/style.css visual responsivo (PC e celular)
public/js/app.js     lógica do cliente e chamada de voz (WebRTC, só áudio)
public/js/i18n.js    textos em pt-BR e en-US
test/                testes do matchmaking (npm test)
```

## Privacidade

O áudio vai direto entre os navegadores (WebRTC peer-to-peer). O servidor só
faz o matchmaking e troca as mensagens de conexão; ele não grava nem ouve a
chamada. Nada fica salvo: ao fechar a aba a pessoa sai da sala.

## Licença

MIT
