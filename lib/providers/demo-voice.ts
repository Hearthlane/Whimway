// The demo planner's voice. Until a live model is connected, these hand-written notes stand
// in for it: one pitch per venue for a date and one for a group, plus the moods it suits.
// They describe well-known, lasting traits of each place; hours and prices stay estimates.
import type { Vibe } from "../schema";

type Note = { vibes: Vibe[]; date: string; crew: string };
export const voice: Record<string, Note> = {
  ballroom: {
    vibes: ["playful", "lively"],
    date: "Ten-pin lanes, ping pong and a big bar under one roof. Loser buys the next round.",
    crew: "Bowling, ping pong and pitchers downtown. Book two lanes and make teams.",
  },
  spin: {
    vibes: ["playful", "lively"],
    date: "A ping pong club with cocktails. You’ll both get competitive within five minutes.",
    crew: "Rent a table by the hour, order snacks, and run a tournament with brackets.",
  },
  tilt: {
    vibes: ["playful", "lively", "cozy"],
    date: "Pay once at the door and every pinball and arcade machine is free to play.",
    crew: "One cover charge, then unlimited pinball and old arcade cabinets all night.",
  },
  batl: {
    vibes: ["adventurous", "playful", "lively"],
    date: "A coach teaches you both to throw an axe, then you play each other. It’s more fun than it sounds.",
    crew: "Axe throwing with a coach and a tournament at the end. Great for a group that hasn’t seen each other in a while.",
  },
  captive: {
    vibes: ["adventurous", "playful"],
    date: "An hour locked in a room solving puzzles together. You learn a lot about each other fast.",
    crew: "Sixty minutes to get out. Someone takes charge, someone finds the key by accident, everyone talks about it after.",
  },
  lob: {
    vibes: ["playful", "lively"],
    date: "Bocce crossed with mini golf, played with a drink in hand. Easy to be bad at together.",
    crew: "A nine-hole bocce course with a bar. Nobody is good at it, which is the point.",
  },
  "for-the-win": {
    vibes: ["cozy", "playful", "chill"],
    date: "Hundreds of board games and staff who’ll teach you one. Order a milkshake and settle in.",
    crew: "A wall of board games and staff who explain the rules. Good for catching up while you play.",
  },
  "comedy-bar": {
    vibes: ["lively", "playful", "cinematic"],
    date: "Stand-up and sketch in a small basement room. Sit near the back if you’d rather not be part of the show.",
    crew: "Cheap tickets, strong line-ups and a bar. You’ll be quoting it on the way home.",
  },
  scotiabank: {
    vibes: ["cinematic", "chill"],
    date: "The big downtown multiplex with IMAX. Take the long escalator and get the good seats.",
    crew: "Big screens and every new release. Easy when the group can’t agree on anything else.",
  },
  "royal-alex": {
    vibes: ["romantic", "cinematic", "artsy"],
    date: "A 1907 theatre with red velvet and gold balconies. Dress up a little.",
    crew: "A big touring musical in a beautiful old theatre. Book ahead.",
  },
  paradise: {
    vibes: ["cinematic", "cozy", "artsy"],
    date: "A restored art-deco cinema showing classics and cult films, with a proper bar.",
    crew: "Old favourites on a big screen in a restored 1930s cinema. Drinks allowed in your seat.",
  },
  illusions: {
    vibes: ["playful", "adventurous", "cinematic"],
    date: "Rooms built to trick your eyes. You’ll come out with a camera roll of ridiculous photos.",
    crew: "Tilted rooms and mirror tricks made for group photos. About an hour, lots of laughing.",
  },
  hhof: {
    vibes: ["playful", "cinematic"],
    date: "The Stanley Cup in an old bank vault, plus games where you shoot on a virtual goalie.",
    crew: "See the Cup, then take shots against a simulated goalie and argue about who’s best.",
  },
  "little-canada": {
    vibes: ["playful", "cozy", "artsy"],
    date: "The whole country built in miniature, with tiny trains and a day-night cycle. Oddly charming.",
    crew: "A miniature Canada with moving trains and hidden jokes to spot. More fun than you’d expect.",
  },
  bata: {
    vibes: ["artsy", "chill"],
    date: "Four and a half thousand years of shoes, from ancient sandals to celebrity sneakers. Small and surprising.",
    crew: "A quick, quirky museum. Everyone finds one pair they can’t believe is real.",
  },
  "high-park": {
    vibes: ["outdoorsy", "chill", "romantic"],
    date: "Trails, a pond and a small free zoo in the city’s biggest park. Bring coffee and wander.",
    crew: "Room to walk and talk, with a zoo and a hillside garden to stumble on.",
  },
  hto: {
    vibes: ["chill", "romantic", "outdoorsy"],
    date: "Yellow umbrellas and sand on the edge of the harbour. Good for sitting and watching the boats.",
    crew: "A city beach with umbrellas by the lake. Easy stop between other things.",
  },
  "bellwoods-brewery": {
    vibes: ["lively", "chill", "foodie"],
    date: "A tiny brewery with a patio on Ossington and some of the best beer in the city.",
    crew: "Share a few bottles of whatever’s new on the patio. It fills up, so go early.",
  },
  mahjong: {
    vibes: ["lively", "romantic", "cinematic"],
    date: "Walk through a pink corner-store front into a hidden bar with a huge mural and good cocktails.",
    crew: "A hidden bar behind a fake convenience store. Loud, pretty and good for a second round.",
  },
  millie: {
    vibes: ["cozy", "foodie", "playful"],
    date: "Japanese crêpe cakes with twenty thin layers. Share two flavours.",
    crew: "Matcha crêpe cake and soft serve to share. A good last stop.",
  },
  kinka: {
    vibes: ["lively", "foodie", "playful"],
    date: "A loud, happy izakaya where the staff shout hello. Order a few small plates and share everything.",
    crew: "Small plates, cold beer and a room that’s already having fun when you walk in.",
  },
  "mothers-dumplings": {
    vibes: ["cozy", "foodie", "chill"],
    date: "Handmade dumplings you can watch being folded. Cheap, warm and hard to stop eating.",
    crew: "Order four kinds of dumplings for the table and fight over the last pan-fried one.",
  },
  sansotei: {
    vibes: ["cozy", "foodie"],
    date: "A small ramen counter with rich tonkotsu broth. In and out in forty minutes, and you’ll both be warm.",
    crew: "Quick, filling bowls of ramen. Good when you want to eat well and keep moving.",
  },
  "buk-chang-dong": {
    vibes: ["cozy", "foodie", "chill"],
    date: "Bubbling tofu stew in a stone pot with all the little side dishes. Simple and comforting.",
    crew: "Stone-pot tofu stew and free side dishes. One of the best cheap meals in Koreatown.",
  },
  "seven-lives": {
    vibes: ["foodie", "lively", "adventurous"],
    date: "Baja-style fish tacos from a tiny Kensington counter. Eat them standing outside, then wander the market.",
    crew: "Big messy tacos for a few dollars each. Grab them and walk through the market.",
  },
  "la-carnita": {
    vibes: ["lively", "foodie", "playful"],
    date: "Tacos, street corn and loud hip-hop under graffiti walls. Finish with the paleta.",
    crew: "Tacos to share, strong drinks and music loud enough that nobody minds your laugh.",
  },
  terroni: {
    vibes: ["romantic", "foodie", "cozy"],
    date: "Proper southern Italian pasta in a busy, candle-warm room. They won’t change the dishes, and they’re right.",
    crew: "Thin pizzas and big bowls of pasta at long tables. Easy for any group.",
  },
  "burgers-priest": {
    vibes: ["foodie", "chill", "playful"],
    date: "A classic griddled cheeseburger done right. Ask about the secret menu.",
    crew: "Smash burgers and a secret menu to argue about. Fast and filling.",
  },
  frans: {
    vibes: ["cozy", "chill", "cinematic"],
    date: "A neon-signed diner that’s been open since 1940. Milkshakes, booths and breakfast all day.",
    crew: "Big booths, all-day breakfast and milkshakes. It suits everyone, at any hour.",
  },
  banjara: {
    vibes: ["cozy", "foodie"],
    date: "Generous North Indian curries and fresh naan. Order the butter chicken and something you’ve never tried.",
    crew: "Curries made for sharing, with plenty of naan. Great value for a group.",
  },
  paramount: {
    vibes: ["foodie", "lively", "chill"],
    date: "Charcoal-grilled skewers and bread that comes out puffed and hot from the oven.",
    crew: "Mixed grill platters, hummus and hot bread for the whole table.",
  },
  "ding-tai-fung": {
    vibes: ["foodie", "cozy"],
    date: "Soup dumplings and Shanghai-style small plates. Go slowly: the soup inside is hot.",
    crew: "Baskets of soup dumplings for the table. Order more than you think you need.",
  },
  "congee-queen": {
    vibes: ["foodie", "chill", "cozy"],
    date: "A huge Cantonese menu with silky congee and crisp salt-and-pepper squid.",
    crew: "Big plates, a long menu and something for everyone, including the picky one.",
  },
  ripleys: {
    vibes: ["romantic", "cinematic", "adventurous"],
    date: "Glass tunnels, slow sharks and blue light. It’s dim and quiet enough to actually talk, and nobody is on their phone.",
    crew: "Walk under the sharks, then argue about which jellyfish tank is best. It’s an easy hour and a half.",
  },
  "cn-tower": {
    vibes: ["romantic", "cinematic", "adventurous"],
    date: "The whole city at your feet. Go near dusk and you get daylight, sunset and the lights coming on in one visit.",
    crew: "Stand on the glass floor and see who looks down first. The view settles every “which way is north” argument.",
  },
  "steam-whistle": {
    vibes: ["lively", "chill"],
    date: "A beer in an old railway roundhouse, right under the tower. Low effort, good atmosphere.",
    crew: "Pints in a railway roundhouse. Big tables, easy to linger, and it’s a short walk to everything downtown.",
  },
  tiff: {
    vibes: ["cinematic", "artsy", "cozy"],
    date: "A proper cinema with films you won’t find at the multiplex. You’ll have something to talk about afterwards.",
    crew: "Pick something none of you have heard of. Worst case, you get a great debate out of it.",
  },
  pai: {
    vibes: ["foodie", "lively", "cozy"],
    date: "Northern Thai in a buzzing basement room. Share a few dishes; the khao soi is the one people come back for.",
    crew: "Loud, warm and made for sharing. Order for the table and pass everything around.",
  },
  "bar-buca": {
    vibes: ["foodie", "romantic", "cozy"],
    date: "Italian small plates in a tall, candlelit room. Easy to stay longer than you planned.",
    crew: "Small Italian plates and a long shared table. Good for grazing while everyone catches up.",
  },
  "graffiti-alley": {
    vibes: ["artsy", "cinematic", "adventurous", "playful"],
    date: "A lane of wall-to-wall murals. It’s free, it’s different every time, and every photo comes out well.",
    crew: "Three blocks of murals to wander. Pick your favourite wall; it’s free and takes as long as you like.",
  },
  dineen: {
    vibes: ["cozy", "chill"],
    date: "Good coffee in a grand old building with a tiled floor. A calm, good-looking place to slow down for half an hour.",
    crew: "A handsome old café for a first coffee while everyone arrives.",
  },
  ago: {
    vibes: ["artsy", "cinematic", "chill"],
    date: "Wander the galleries at your own pace. The wooden spiral staircase alone is worth the visit.",
    crew: "Split up, find the strangest piece, then meet at the big wooden staircase to compare.",
  },
  "allan-gardens": {
    vibes: ["romantic", "chill", "cozy", "outdoorsy"],
    date: "A Victorian glasshouse full of palms and orchids. It’s warm, green and free, even in November.",
    crew: "A warm glass palm house in the middle of the city. Free, and a good reset between stops.",
  },
  "st-lawrence": {
    vibes: ["foodie", "lively"],
    date: "Graze your way through the market stalls. Splitting a peameal bacon sandwich is the tradition.",
    crew: "Everyone picks one thing from a different stall and you share. That’s lunch.",
  },
  "sugar-beach": {
    vibes: ["romantic", "chill", "outdoorsy", "cinematic"],
    date: "Pink umbrellas, sand and the lake. Take your drinks or dessert here and watch the boats.",
    crew: "Claim a couple of the pink umbrellas by the water. Nothing to do here, which is the point.",
  },
  island: {
    vibes: ["romantic", "adventurous", "outdoorsy", "cinematic"],
    date: "A short ferry ride and the skyline is suddenly across the water. It’s the best view of the city there is.",
    crew: "The ferry is half the fun. Once you’re over, the skyline view makes everyone’s photos.",
  },
  kensington: {
    vibes: ["artsy", "foodie", "playful", "adventurous"],
    date: "Vintage shops, tiny food counters and street art packed into a few blocks. Wander with no plan.",
    crew: "A few blocks of vintage racks and snack counters. Give everyone ten dollars and see what they come back with.",
  },
  "grey-gardens": {
    vibes: ["romantic", "foodie", "cozy"],
    date: "A soft-lit wine bar where the plates are small and the conversation is easy. Sit at the bar if you can.",
    crew: "Wine and small plates in a calm, pretty room. Better for four than for ten.",
  },
  "bar-raval": {
    vibes: ["romantic", "cinematic", "foodie", "lively"],
    date: "Carved mahogany walls that look grown, not built, and tapas you eat standing. It feels like another city.",
    crew: "Stand at the bar, point at whatever looks good, repeat. The room is the conversation starter.",
  },
  libretto: {
    vibes: ["foodie", "cozy", "chill"],
    date: "Blistered Neapolitan pizza from a wood oven. Simple, quick and hard to get wrong.",
    crew: "Wood-fired pizza for the table. Order one more than you think you need.",
  },
  "bang-bang": {
    vibes: ["playful", "foodie", "cozy"],
    date: "Ice cream sandwiched in a warm cookie. Share one, or don’t.",
    crew: "Build-your-own ice cream sandwiches. Expect a line and expect it to be worth it.",
  },
  "track-field": {
    vibes: ["playful", "lively", "adventurous"],
    date: "Indoor bocce and shuffleboard with a drink in hand. A little competition does a date good.",
    crew: "Bocce and shuffleboard lanes under a bar. Pick teams; losers buy the next round.",
  },
  "trinity-bellwoods": {
    vibes: ["chill", "outdoorsy", "romantic"],
    date: "The park everyone in the neighbourhood ends up in. Find a bench and people-watch.",
    crew: "Bring something to share and take over a patch of grass. Keep an eye out for the white squirrels.",
  },
  nadege: {
    vibes: ["cozy", "romantic", "foodie"],
    date: "Macarons and pastries that look like jewellery. Pick two each and trade.",
    crew: "A box of macarons to pass around. Everyone has a favourite colour within a minute.",
  },
  "snakes-lattes": {
    vibes: ["playful", "cozy", "lively"],
    date: "A wall of board games and someone to recommend one. You learn a lot about a person over a game.",
    crew: "Hundreds of games and staff who’ll teach you one. The evening takes care of itself.",
  },
  rom: {
    vibes: ["artsy", "cinematic", "adventurous"],
    date: "Dinosaurs, gems and mummies under one roof. Choose two galleries and take your time.",
    crew: "Go straight to the dinosaurs, then let everyone pick one gallery each.",
  },
  "casa-loma": {
    vibes: ["romantic", "cinematic", "adventurous"],
    date: "An actual castle on a hill, with towers to climb and a view back over the city.",
    crew: "Secret passages, towers and a tunnel. It’s a castle; nobody stays cool about it.",
  },
  distillery: {
    vibes: ["romantic", "cinematic", "artsy", "cozy"],
    date: "Cobblestones, old brick and string lights, with no cars. The whole district feels like a film set after dark.",
    crew: "Car-free cobblestone lanes full of galleries and shops. Easy to wander without a plan.",
  },
  balzacs: {
    vibes: ["cozy", "romantic", "chill"],
    date: "Coffee under a chandelier in an old pump house. A warm first stop.",
    crew: "A two-storey café in the old distillery. Meet here and warm up first.",
  },
  "el-catrin": {
    vibes: ["lively", "foodie", "cinematic", "romantic"],
    date: "Mexican plates under a floor-to-ceiling mural, with a firelit patio. Order the guacamole made at the table.",
    crew: "Big sharing plates, a huge mural and a patio with fire pits. It’s loud in the good way.",
  },
  riverdale: {
    vibes: ["romantic", "cinematic", "outdoorsy", "chill"],
    date: "A hillside facing the whole skyline. Get there for sunset and stay as the lights come on.",
    crew: "The classic skyline hill. Bring snacks and sit on the slope.",
  },
  "brick-works": {
    vibes: ["outdoorsy", "chill", "artsy"],
    date: "Old kilns, ponds and ravine trails ten minutes from downtown. Feels a long way from the city.",
    crew: "Trails, ponds and old brick kilns to explore. Good for clearing heads.",
  },
  rorschach: {
    vibes: ["lively", "chill", "playful"],
    date: "A neighbourhood brewery with a patio. Share a flight and compare notes.",
    crew: "Order flights and rank them. Somebody always takes the scoring too seriously.",
  },
  "lady-marmalade": {
    vibes: ["foodie", "cozy", "chill"],
    date: "A bright, plant-filled brunch spot. Go for the eggs benedict and don’t rush.",
    crew: "Brunch worth queueing for. Send one person ahead to put your name down.",
  },
  "aga-khan": {
    vibes: ["artsy", "romantic", "cinematic", "chill"],
    date: "White stone, reflecting pools and quiet galleries. One of the calmest, most beautiful buildings in the city.",
    crew: "A striking museum with gardens and pools outside. Calm, and different from the usual.",
  },
  botanical: {
    vibes: ["romantic", "outdoorsy", "chill"],
    date: "Themed gardens to stroll through, with paths leading down into the ravine.",
    crew: "Garden paths to wander, with trails beyond if you want a longer walk.",
  },
  "mel-lastman": {
    vibes: ["chill", "lively"],
    date: "An open square by the water feature, with a skating rink in winter. A simple place to walk and talk.",
    crew: "A central square to meet in. In winter there’s skating.",
  },
  bluffers: {
    vibes: ["adventurous", "outdoorsy", "romantic", "cinematic"],
    date: "White cliffs dropping into the lake, with a beach at the bottom. It doesn’t look like Toronto.",
    crew: "Cliffs, a beach and a marina. Worth the trip east just for the photos.",
  },
  "pacific-mall": {
    vibes: ["foodie", "playful", "adventurous"],
    date: "A maze of tiny shops with a food court upstairs. Come hungry and try things you can’t name.",
    crew: "Bubble tea, snacks and gadget stalls. Split up and reconvene at the food court.",
  },
  unionville: {
    vibes: ["romantic", "cozy", "chill", "cinematic"],
    date: "A village main street of old storefronts, patios and ice cream. Made for a slow walk.",
    crew: "A pretty main street with patios and sweet shops. Easy to fill an afternoon.",
  },
  toogood: {
    vibes: ["romantic", "chill", "outdoorsy"],
    date: "A quiet loop around the pond, right behind Main Street. Good for after dinner.",
    crew: "A flat, easy loop around the water. Good for walking off a meal.",
  },
  milne: {
    vibes: ["outdoorsy", "adventurous", "chill"],
    date: "Trails along the river and a suspension bridge. A proper walk without leaving town.",
    crew: "River trails and a bridge to cross. Wear real shoes.",
  },
  "mill-pond": {
    vibes: ["romantic", "chill", "outdoorsy"],
    date: "A small pond with swans and a path all the way round. Quiet in the evening.",
    crew: "A short lakeside loop with benches. A calm start or finish.",
  },
  "rh-theatre": {
    vibes: ["artsy", "cinematic", "romantic"],
    date: "Live music, comedy or theatre, depending on the night. Check what’s on and book ahead.",
    crew: "A proper night at the theatre. Check the programme first; it changes weekly.",
  },
  "lake-wilcox": {
    vibes: ["outdoorsy", "romantic", "chill"],
    date: "A boardwalk along the water, best around sunset.",
    crew: "Boardwalk, lake and plenty of room to spread out.",
  },
  hillcrest: {
    vibes: ["chill", "playful"],
    date: "An easy indoor stop to browse and grab a bite, whatever the weather.",
    crew: "Somewhere warm to wander and eat while you decide what’s next.",
  },
  "dave-busters": {
    vibes: ["playful", "lively", "adventurous"],
    date: "Arcade games, air hockey and prizes. Loser buys dinner.",
    crew: "A floor of arcade games and a bar. Set a ticket target and see who gets there first.",
  },
  reptilia: {
    vibes: ["adventurous", "playful"],
    date: "Crocodiles, giant snakes and tiny frogs behind glass. Stranger and better than it sounds.",
    crew: "Giant snakes and crocodiles up close. Find out who’s secretly squeamish.",
  },
  "vaughan-mills": {
    vibes: ["chill", "playful"],
    date: "A big indoor loop of shops and food. Easy, warm and no planning needed.",
    crew: "One long indoor loop. Good for a wander and a food-court stop.",
  },
  legoland: {
    vibes: ["playful", "adventurous"],
    date: "A miniature Toronto built from bricks, plus rides. It’s meant for kids, and fun if you lean into it.",
    crew: "Miniature cities, rides and build tables. Best with children in the group.",
  },
  wonderland: {
    vibes: ["adventurous", "lively", "playful"],
    date: "Roller coasters all day. Check the season first; it isn’t open year-round.",
    crew: "A full day of coasters. Seasonal, so check it’s open before you go.",
  },
  kortright: {
    vibes: ["outdoorsy", "chill", "adventurous"],
    date: "Forest trails and a quiet valley. A real walk in the woods, half an hour from the city.",
    crew: "Kilometres of forest trail. Bring water and decent shoes.",
  },
  "rec-room": {
    vibes: ["playful", "lively", "adventurous"],
    date: "Arcade games, virtual reality and a bar in the old roundhouse. Competitive in the fun way.",
    crew: "A huge games hall with food and drinks. Set a challenge and keep score.",
  },
  "second-city": {
    vibes: ["lively", "playful", "cinematic"],
    date: "Live sketch comedy from the troupe that trained half of TV. Laughing together is underrated on a date.",
    crew: "A sketch comedy show. Book seats together and expect to be picked on if you sit at the front.",
  },
  "nathan-phillips": {
    vibes: ["romantic", "cinematic", "chill"],
    date: "The lit-up Toronto sign and City Hall’s curved towers. In winter there’s skating under the arches.",
    crew: "The Toronto sign, the big photo everyone takes. Skating in winter.",
  },
  harbourfront: {
    vibes: ["romantic", "chill", "outdoorsy", "artsy"],
    date: "A slow walk along the lake with the islands across the water. Often there’s free art or music on.",
    crew: "A lakeside walk with galleries and events along the way, usually free.",
  },
  barchef: {
    vibes: ["romantic", "cinematic", "adventurous", "foodie"],
    date: "A dark, candlelit bar where cocktails arrive smoking under glass. One drink here is an event.",
    crew: "Theatrical cocktails in a moody room. Come for one memorable round.",
  },
  ddo: {
    vibes: ["romantic", "cinematic", "adventurous"],
    date: "A historic observatory with a giant telescope. Evening programmes need booking; check the schedule.",
    crew: "A real observatory with public nights. Book ahead and hope for clear skies.",
  },
  colossus: {
    vibes: ["cinematic", "playful", "chill"],
    date: "A big-screen cinema shaped like a spaceship. Popcorn, recliners, done.",
    crew: "The giant flying-saucer cinema. Easy win for a group that can’t decide.",
  },
};
