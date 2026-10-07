/*global performCalculations: true, addToDex: true, getMoves: true, findSpecies, calculateAllMoves: true, getSetOptions: true, getFirstValidSetOption: true, loadDefaultLists: true, updateTheme: true, prefersDarkTheme: true, getSelectOptions, calcHP, calcStats, checkStatBoost, PC_HANDLER, ExportPokemon, setdex, totalEVs, SETDEX, SIM_SETDEX, correctHiddenPower, setSelectValueIfValid */
var SIM_PARAMS = new URLSearchParams(window.location.search);
var SIM_CLIENT = SIM_PARAMS.get('client') || window.location.hostname.replace(/^calc\./, 'play.');
var SIM_DOMAIN = SIM_CLIENT.replace(/^play\./, '');
var SIM_LOGO = '//home.' + SIM_DOMAIN + '/images/pokemonshowdownbeta';
var SIM_NAV = [
	'//' + SIM_DOMAIN + '/', '//dex.pokemonshowdown.com/', '//replay.' + SIM_DOMAIN + '/',
	'https://pokeathlon.wiki.gg/', 'https://discord.gg/AY9UmkTKuh', '//' + SIM_CLIENT + '/'
];
var SIM_FIELD_ICONS = ['Pyukumuku', 'Dunsparce'];
var SIM_DEFAULT_MOD = 'gen9chaosmayhem';
var SIM_COMMON_ITEMS = [
	'Choice Band', 'Choice Specs', 'Choice Scarf', 'Life Orb', 'Assault Vest', 'Leftovers', 'Focus Sash', 'Muscle Band',
	'Wise Glasses', 'Protective Pads', 'Expert Belt', 'Rocky Helmet', 'Heavy-Duty Boots', 'White Herb', 'Electric Seed',
	'Grassy Seed', 'Misty Seed', 'Psychic Seed', 'Power Herb', 'Mental Herb', 'Sitrus Berry', 'Lum Berry'
];
var SIM_STATS = {hp: 'hp', atk: 'at', def: 'df', spa: 'sa', spd: 'sd', spe: 'sp'};
var SIM_FLAGS = {
	makesContact: 'contact', isPunch: 'punch', isBite: 'bite', isBullet: 'bullet',
	isSound: 'sound', isPulse: 'pulse', isSlicing: 'slicing', isWind: 'wind'
};
var SIM_ABILITY_TOGGLES = {
	'Intimidate': true, 'Slow Start': true, 'Teraform Zero': true, 'Intrepid Sword': true, 'Dauntless Shield': true, 'Analytic': false,
	'Flash Fire': false, 'Unburden': false, 'Electromorphosis': false, 'Stakeout': false, 'Plus': false, 'Minus': false
};
var SIM_ABILITY_VOLATILES = {'Flash Fire': 'flashfire', 'Unburden': 'unburden', 'Electromorphosis': 'charge'};
var SIM_SIDE_VOLATILES = {
	isProtected: 'protect', isSeeded: 'leechseed', isNightmared: 'nightmare', isSaltCured: 'saltcure',
	isForesight: 'foresight', isCharge: 'charge', isHelpingHand: 'helpinghand', isPowerTrick: 'powertrick'
};
var SIM_COLOR_CODES = {
	'Speed Borders': {'sim-speed-faster': "Outspeeds", 'sim-speed-tie': "Speed tie", 'sim-speed-slower': "Slower"},
	'OHKO Colors': {
		'sim-dmg-WMO': "Hard counter (gets 4HKO'd at worst and may OHKO)",
		'sim-dmg-W': "Wall (gets 4HKO'd at worst and does more damage)",
		'sim-dmg-1': "Always OHKOs", 'sim-dmg-2': "Might OHKO", 'sim-dmg-3': "Might get OHKO'd", 'sim-dmg-4': "Always gets OHKO'd",
		'sim-dmg-14': "Both sides OHKO each other", 'sim-dmg-23': "Both sides might OHKO each other",
		'sim-dmg-13': "Always OHKOs but might get OHKO'd", 'sim-dmg-24': "Might OHKO but always gets OHKO'd"
	}
};
var SIM_SIDE_CONDITIONS = {
	isSR: 'Stealth Rock', steelsurge: 'G-Max Steelsurge', vinelash: 'G-Max Vine Lash', wildfire: 'G-Max Wildfire',
	cannonade: 'G-Max Cannonade', volcalith: 'G-Max Volcalith', isReflect: 'Reflect', isLightScreen: 'Light Screen',
	isAuroraVeil: 'Aurora Veil', isTailwind: 'Tailwind'
};

var simMods = {};
var simMod = null;
var simLegal = null;
var simData = {};
var simResults = null;
var simSpeeds = null;
var simWorkers = [];
var simWorkerMod = null;
var simCache = {};
var simCacheSize = 0;
var simMain = null;
var simBoxes = {};
var simCalculationPending = false;
var simCalculationStale = false;
var simRenderFrame = null;
var simRenderStale = false;
var simRequest = 0;
var simBoxRequest = 0;
var simPresetRequest = 0;
var simManualWeather = false;
var simManualTerrain = false;
var simItemSide = null;
var simSelectedMove = null;
var simGetGeneration = calc.Generations.get;
var simPerformCalculations = performCalculations;
var simAddToDex = addToDex;
var simGetMoves = getMoves;
var simImportSide = null;

function SimTable(entries) {
	this.entries = entries;
}

SimTable.prototype.get = function (id) {
	return this.entries[id];
};

function makeSimGeneration(data) {
	var species = {};
	var moves = {};
	var items = {};
	var abilities = {};
	var types = {};
	var name, id, key;
	for (name in data.species) {
		var specie = $.extend({}, data.species[name]);
		id = calc.toID(name);
		specie.kind = 'Species';
		specie.id = id;
		specie.name = name;
		specie.baseStats = {};
		for (key in SIM_STATS) specie.baseStats[key] = specie.bs[SIM_STATS[key]];
		species[id] = specie;
	}
	for (name in data.moves) {
		var moveData = data.moves[name];
		id = calc.toID(name);
		var move = {kind: 'Move', id: id, name: name, flags: {}, basePower: moveData.bp};
		for (key in moveData) {
			if (SIM_FLAGS[key]) {
				move.flags[SIM_FLAGS[key]] = 1;
			} else if (key !== 'bp' && key !== 'zp' && key !== 'maxPower') {
				move[key] = moveData[key];
			}
		}
		if (moveData.zp) move.zMove = {basePower: moveData.zp};
		if (moveData.maxPower) move.maxMove = {basePower: moveData.maxPower};
		if (!move.category) move.category = 'Status';
		moves[id] = move;
	}
	for (name in data.items) {
		id = calc.toID(name);
		items[id] = $.extend({kind: 'Item', id: id, name: name}, data.items[name]);
	}
	for (var i = 0; i < data.abilities.length; i++) {
		id = calc.toID(data.abilities[i]);
		abilities[id] = {kind: 'Ability', id: id, name: data.abilities[i]};
	}
	for (name in data.typeChart) {
		id = calc.toID(name);
		types[id] = {kind: 'Type', id: id, name: name, effectiveness: data.typeChart[name]};
	}
	return {
		num: data.gen,
		species: new SimTable(species),
		moves: new SimTable(moves),
		items: new SimTable(items),
		abilities: new SimTable(abilities),
		types: new SimTable(types),
		natures: simGetGeneration.call(calc.Generations, data.gen).natures
	};
}

function makeSimButtons(names, type, name, side) {
	var buf = '';
	for (var i = 0; i < names.length; i++) {
		var id = 'sim-' + calc.toID(names[i]) + (side || '');
		var value = name === 'terrain' ? names[i].replace(/ Terrain$/, '') : names[i];
		buf += '<input class="visually-hidden calc-trigger" type="' + type + '" name="' + name + '" value="' + value + '" id="' + id + '" />';
		var position = names.length < 2 ? '' : i === 0 ? ' btn-left' : i === names.length - 1 ? ' btn-right' : ' btn-mid';
		buf += '<label class="btn btn-xxxwide' + position + '" for="' + id + '">' + names[i].replace(/([a-z])([A-Z])/g, '$1 $2') + '</label> ';
	}
	return buf;
}

function simGameType() {
	return $("#doubles-format").prop("checked") ? 'doubles' : 'singles';
}

function installSimData(mod, data) {
	var generation = makeSimGeneration(data);
	calc.SPECIES[data.gen] = data.species;
	calc.SPECIES[9] = data.species;
	calc.MOVES[data.gen] = data.moves;
	calc.ITEMS[data.gen] = Object.keys(data.items);
	calc.ABILITIES[data.gen] = data.abilities;
	calc.TYPE_CHART[data.gen] = data.typeChart;
	calc.Generations.get = function (num) {
		return num === data.gen ? generation : simGetGeneration.call(calc.Generations, num);
	};
	simMod = mod;
	var names = Object.keys(data.species);
	simLegal = {};
	$.each(data.legal, function (i, index) {
		simLegal[names[index]] = true;
	});
	$("#gen" + data.gen).prop("checked", true).change();
	var speciesOptions = "<option value=\"\">(none)</option>" + getSelectOptions(names.filter(function (name) {
		return !simLegal || simLegal[name];
	}), true);
	$(".poke-info").toggleClass("sim-fusable", mod.fusion).find("select.fusion").html(speciesOptions).select2("val", "");
	var abilityOptions = "<option value=\"\">(none)</option>" + getSelectOptions(data.abilities.slice(), true);
	$(".sim-ability2").toggle(mod.ability2).find("select").html(abilityOptions).val("").change();
	simManualWeather = false;
	simManualTerrain = false;
	$(".sim-weather").html(makeSimButtons(data.conditions.weather, 'radio', 'weather'));
	$(".sim-terrain").html(makeSimButtons(data.conditions.terrain, 'checkbox', 'terrain'));
	$(".sim-field").html(makeSimButtons(data.conditions.field, 'checkbox', ''));
	$(".sim-side").remove();
	for (var i = 0; i < data.conditions.side.length; i++) {
		$("#exportL").closest("tr").before(
			"<tr class=\"sim-side sim-conditions\">" +
			"<td><div class=\"left\">" + makeSimButtons([data.conditions.side[i]], 'checkbox', '', 'L') + "</div></td>" +
			"<td><div class=\"right\">" + makeSimButtons([data.conditions.side[i]], 'checkbox', '', 'R') + "</div></td></tr>"
		);
	}
	$(".sim-terrain input").change(function () {
		$("input:checkbox[name='terrain']").not(this).prop("checked", false);
	});
	$(".sim-conditions input").bind("change keyup", PC_HANDLER);
	showSimItems();
	showSimBox();
	performCalculations();
}

function loadSimMod(id) {
	SIM_PARAMS.set('mod', id);
	SIM_PARAMS.delete('format');
	window.history.replaceState({}, document.title, window.location.pathname + '?' + SIM_PARAMS);
	loadSimWorker(simMods[id]);
	if (simData[id]) return installSimData(simMods[id], simData[id]);
	$.getJSON("./sim-data/" + id + ".json?" + (simMods[id].hash || ""), function (data) {
		simData[id] = data;
		if ($("#sim-mod").val() === id) installSimData(simMods[id], data);
	});
}

function loadSimWorker(mod) {
	if (simWorkerMod === mod) return;
	for (var i = 0; i < simWorkers.length; i++) simWorkers[i].terminate();
	simWorkerMod = mod;
	simWorkers = [];
	simCache = {};
	simCacheSize = 0;
	var count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
	for (var j = 0; j < count; j++) {
		var worker = new Worker("./sim-data/" + mod.id + ".js?" + (mod.hash || ""));
		worker.onmessage = receiveSimResponse;
		simWorkers.push(worker);
	}
}

function receiveSimResponse(event) {
	var response = event.data;
	if (response.side) {
		var pokeInfo = $("#" + response.side);
		if (pokeInfo.data("simPresetRequest") !== response.id) return;
		var role = pokeInfo.data("simPresetRole") === true ? response.presets && response.presets.role : pokeInfo.data("simPresetRole");
		pokeInfo.data("simPresets", response.presets);
		showSimSpreads(pokeInfo);
		if (role) applySimPreset(pokeInfo, response.presets && response.presets.sets[role] ? role : "Blank Set");
		return;
	}
	var request = response.id === simRequest ? simMain : simBoxes[response.id];
	if (!request) return;
	if (response.speeds) {
		simCache[request.speedKey] = {result: response.speeds};
		simSpeeds = response.speeds;
		$("#p1 .sp .totalMod").text(simSpeeds[0]);
		$("#p2 .sp .totalMod").text(simSpeeds[1]);
		return;
	}
	request.results[response.index] = response.result;
	if (!response.result.pending) {
		if (++simCacheSize > 5000) {
			simCache = {};
			simCacheSize = 1;
		}
		simCache[request.keys[response.index]] = {result: response.result, full: response.full};
	}
	if (request.panel) {
		if (request.panel.hasClass("sim-cc-on") && !--request.remaining) colorSimBox(request.panel, request.results);
	} else if (!response.full) {
		if (--request.ranges) return;
		showSimResults();
		requestSimFull();
	} else {
		if (!response.result.pending) request.full--;
		if (simRenderFrame && response.index !== request.selected) {
			simRenderStale = true;
		} else {
			showSimResults();
			simRenderStale = false;
			simRenderFrame = simRenderFrame || requestAnimationFrame(function () {
				simRenderFrame = null;
				if (simRenderStale && !simMain.ranges) showSimResults();
				simRenderStale = false;
			});
		}
		if (!request.full) requestSimBox($(".sim-box-panel").has(".sim-cc-auto:checked"));
	}
}

function showSimResults() {
	simResults = simMain.results;
	showSimField();
	showSimSpecies($("#p1"), 0);
	showSimSpecies($("#p2"), 1);
	simPerformCalculations();
	if (simSelectedMove && !$(".locked-move").length) $("#" + simSelectedMove).prop("checked", true).change();
}

function requestSimFull() {
	var id = $(".result-move:checked").attr("id") || '';
	var selected = simMain.selected = 2 * (id.slice(-1) - 1) + (id.charAt(10) === 'R' ? 1 : 0);
	var jobs = simWorkers.map(function () {
		return [];
	});
	for (var i = 0; i < simMain.jobs.length; i++) {
		var index = simMain.jobs[i];
		jobs[simMain.owners[index]][index === selected ? 'unshift' : 'push']([index, simMain.calcs[index]]);
	}
	for (var j = 0; j < simWorkers.length; j++) {
		if (jobs[j].length) simWorkers[j].postMessage({id: simMain.id, format: simMain.format, calcs: jobs[j], full: true});
	}
}

function showSimField() {
	for (var i = 0; i < simResults.length; i++) {
		if (!simResults[i] || !simResults[i].field) continue;
		var field = simResults[i].field;
		$("input:radio[name='weather'][value='" + field.weather + "']").prop("checked", true);
		$("input:checkbox[name='terrain']").prop("checked", false);
		$("input:checkbox[name='terrain'][value='" + field.terrain + "']").prop("checked", true);
		return;
	}
}

function simFusion(pokeInfo) {
	return simMod.fusion && pokeInfo.find(".sim-fusion").hasClass("sim-open") ? pokeInfo.find("select.fusion").val() : '';
}

function restoreSimSpecies(pokeInfo) {
	var species = pokedex[createPokemon(pokeInfo).name];
	for (var stat in SIM_STATS) {
		pokeInfo.find("." + SIM_STATS[stat] + " .base").val(species.bs[SIM_STATS[stat]]);
	}
	pokeInfo.find(".type1").val(species.types[0]);
	pokeInfo.find(".type2").val(species.types[1] || "");
	calcHP(pokeInfo);
	calcStats(pokeInfo);
}

function showSimSpecies(pokeInfo, side) {
	if (!simFusion(pokeInfo)) return;
	for (var i = 0; i < simResults.length; i++) {
		if (!simResults[i] || !simResults[i].species) continue;
		var species = simResults[i].species[(i + side) % 2];
		for (var stat in SIM_STATS) {
			pokeInfo.find("." + SIM_STATS[stat] + " .base").val(species.baseStats[stat]);
		}
		pokeInfo.find(".type1").val(species.types[0]);
		pokeInfo.find(".type2").val(species.types[1] || "");
		calcHP(pokeInfo);
		calcStats(pokeInfo);
		return;
	}
}

function simAbilities(pokemon, pokeInfo) {
	var abilities = {ability: [pokemon.ability, pokemon.abilityOn]};
	if (simMod.ability2 && pokeInfo.find("select.ability2").val()) {
		abilities.ability2 = [pokeInfo.find("select.ability2").val(), pokeInfo.find(".ability2Toggle").is(":checked")];
	}
	return abilities;
}

function makeSimSet(pokemon, pokeInfo, side) {
	var set = {
		species: pokemon.name,
		level: pokemon.level,
		ability: pokemon.ability,
		item: pokemon.item,
		nature: pokemon.nature,
		gender: pokemon.gender,
		evs: pokemon.evs,
		ivs: pokemon.ivs,
		boosts: {},
		volatiles: []
	};
	for (var stat in pokemon.boosts) {
		if (stat !== 'hp' && pokemon.boosts[stat]) set.boosts[stat] = pokemon.boosts[stat];
	}
	if (pokemon.status) set.status = pokemon.status;
	if (pokemon.originalCurHP < pokemon.rawStats.hp) set.hp = pokemon.originalCurHP;
	if (pokemon.teraType) {
		set.teraType = pokemon.teraType;
		set.tera = true;
	}
	if (pokemon.isDynamaxed) {
		set.dynamax = true;
		set.gigantamax = pokemon.isDynamaxed === 'gmax';
	}
	if (pokemon.alliesFainted) set.alliesFainted = pokemon.alliesFainted;
	if (simFusion(pokeInfo)) set.fusion = simFusion(pokeInfo);
	var abilities = simAbilities(pokemon, pokeInfo);
	if (abilities.ability2) set.ability2 = abilities.ability2[0];
	for (var slot in abilities) {
		var ability = abilities[slot][0];
		if (SIM_ABILITY_TOGGLES[ability] === undefined) continue;
		if (SIM_ABILITY_VOLATILES[ability]) {
			if (abilities[slot][1]) set.volatiles.push(SIM_ABILITY_VOLATILES[ability]);
		} else if (!abilities[slot][1]) {
			set[slot] = 'No Ability';
		}
	}
	if (pokemon.boostedStat && pokemon.boostedStat !== 'auto' &&
		(pokemon.ability === 'Protosynthesis' || pokemon.ability === 'Quark Drive')) {
		set.volatiles.push(calc.toID(pokemon.ability));
	}
	for (var key in SIM_SIDE_VOLATILES) {
		if (side[key]) set.volatiles.push(SIM_SIDE_VOLATILES[key]);
	}
	return set;
}

function makeSimAlly(pokemon, side, defending) {
	var ability = side.isFlowerGift ? 'Flower Gift' : defending ? (side.isFriendGuard ? 'Friend Guard' : 'No Ability') :
		side.isBattery ? 'Battery' : side.isPowerSpot ? 'Power Spot' : side.isSteelySpirit ? 'Steely Spirit' : '';
	if (!ability) return undefined;
	return {species: ability === 'Flower Gift' ? 'Cherrim' : pokemon.name, ability: ability};
}

function makeSimQuery(attacker, defender, move, field, attackerInfo, defenderInfo) {
	if (move.originalName === '(No Move)') return null;
	var query = {
		move: move.originalName,
		crit: move.isCrit,
		hits: move.hits,
		attacker: makeSimSet(attacker, attackerInfo, field.attackerSide),
		defender: makeSimSet(defender, defenderInfo, field.defenderSide),
		field: {
			pseudoWeather: [],
			attackerSide: [],
			defenderSide: []
		}
	};
	if (simManualWeather) query.field.weather = field.weather || '';
	if (simManualTerrain) query.field.terrain = field.terrain || '';
	$(".sim-field input:checked").each(function () {
		query.field.pseudoWeather.push($(this).val());
	});
	var attackerSide = attackerInfo.attr("id") === "p2" || defenderInfo.attr("id") === "p1" ? "right" : "left";
	$(".sim-side input:checked").each(function () {
		query.field[$(this).parent().hasClass(attackerSide) ? 'attackerSide' : 'defenderSide'].push($(this).val());
	});
	if (move.useZ) query.attacker.zmove = true;
	if (field.isMagicRoom) query.field.pseudoWeather.push('Magic Room');
	if (field.isWonderRoom) query.field.pseudoWeather.push('Wonder Room');
	if (field.isGravity) query.field.pseudoWeather.push('Gravity');
	var sides = {attackerSide: field.attackerSide, defenderSide: field.defenderSide};
	for (var side in sides) {
		for (var key in SIM_SIDE_CONDITIONS) {
			if (sides[side][key]) query.field[side].push(SIM_SIDE_CONDITIONS[key]);
		}
		for (var i = 0; i < sides[side].spikes; i++) query.field[side].push('Spikes');
	}
	if (simGameType() === 'doubles') {
		query.attackerAlly = makeSimAlly(attacker, field.attackerSide, false);
		query.defenderAlly = makeSimAlly(defender, field.defenderSide, true);
	}
	var abilities = simAbilities(attacker, attackerInfo);
	for (var slot in abilities) {
		if (!abilities[slot][1]) continue;
		if (abilities[slot][0] === 'Stakeout') query.defender.activeTurns = 0;
		if ((abilities[slot][0] === 'Plus' || abilities[slot][0] === 'Minus') && simGameType() === 'doubles') {
			query.attackerAlly = query.attackerAlly || {species: attacker.name, ability: 'Plus'};
		}
	}
	return query;
}

function SimResult(attacker, defender, move, data) {
	this.attacker = attacker;
	this.defender = defender;
	this.move = move;
	this.data = data || {maxhp: defender.maxHP()};
	this.damage = this.data.damage || 0;
}

SimResult.prototype.range = function () {
	var damage = [].concat(this.damage);
	return [damage[0], damage[damage.length - 1]];
};

SimResult.prototype.display = function (value, total, notation) {
	return notation === '%' ? Math.floor(value * 1000 / total) / 10 : Math.floor(value * 48 / total);
};

SimResult.prototype.moveDesc = function (notation) {
	var range = this.range();
	var text = this.display(range[0], this.data.maxhp, notation) + ' - ' + this.display(range[1], this.data.maxhp, notation) + notation;
	var change = this.data.attackerChange;
	if (change && (change[0] || change[1])) {
		text += ' (' + this.display(Math.abs(change[0]), this.data.attackerMaxHP, notation) + ' - ' +
			this.display(Math.abs(change[1]), this.data.attackerMaxHP, notation) + notation +
			(change[1] > 0 ? ' recovered)' : ' recoil damage)');
	}
	return text;
};

SimResult.prototype.fullDesc = function (notation) {
	if (this.data.error) return this.data.error;
	var range = this.range();
	var damage = range[0] + '-' + range[1] + ' (' + this.display(range[0], this.data.maxhp, notation) + ' - ' +
		this.display(range[1], this.data.maxhp, notation) + notation + ')';
	if (!this.data.description) return this.move.name + ': ' + damage + (this.data.damage ? ' -- simulating...' : '');
	return this.data.description + ': ' + damage + (this.data.ko ? ' -- ' + this.data.ko : '') + (this.data.pending ? ' (simulating...)' : '');
};

SimResult.prototype.desc = function () {
	return this.fullDesc('%');
};

performCalculations = function () {
	if (simCalculationPending) {
		simCalculationStale = true;
		return;
	}
	requestSimResults();
	simCalculationPending = true;
	setTimeout(function () {
		simCalculationPending = false;
		if (simCalculationStale) requestSimResults();
		simCalculationStale = false;
	});
};

function requestSimResults() {
	if (!simMod || simWorkerMod !== simMod) return;
	var p1info = $("#p1");
	var p2info = $("#p2");
	var p1 = createPokemon(p1info);
	var p2 = createPokemon(p2info);
	var p1field = createField();
	var p2field = p1field.clone().swap();
	checkStatBoost(p1, p2);
	var calcs = [];
	for (var i = 0; i < 4; i++) {
		calcs.push(makeSimQuery(p1, p2, p1.moves[i], p1field, p1info, p2info));
		calcs.push(makeSimQuery(p2, p1, p2.moves[i], p2field, p2info, p1info));
	}
	var format = simGameType();
	var speed = makeSimQuery(p1, p2, {}, p1field, p1info, p2info);
	simRequest++;
	simMain = {
		id: simRequest, format: format, calcs: calcs, speedKey: 'speed' + format + JSON.stringify(speed),
		keys: [], results: [], owners: [], jobs: []
	};
	simSpeeds = simCache[simMain.speedKey] ? simCache[simMain.speedKey].result : null;
	var jobs = simWorkers.map(function () {
		return [];
	});
	for (var j = 0; j < calcs.length; j++) {
		if (!calcs[j]) continue;
		var key = simMain.keys[j] = format + JSON.stringify(calcs[j]);
		if (simCache[key] && simCache[key].full) {
			simMain.results[j] = simCache[key].result;
		} else {
			simMain.owners[j] = simMain.jobs.length % simWorkers.length;
			jobs[simMain.owners[j]].push([j, calcs[j]]);
			simMain.jobs.push(j);
		}
	}
	simMain.ranges = simMain.full = simMain.jobs.length;
	for (var k = 0; k < simWorkers.length; k++) {
		simWorkers[k].postMessage({id: simRequest, format: format, calcs: jobs[k], speed: !k && !simSpeeds ? speed : null});
	}
	if (!simMain.jobs.length) {
		showSimResults();
		requestSimBox($(".sim-box-panel").has(".sim-cc-auto:checked"));
	}
	showSimIcons([p1, p2]);
}

getSetOptions = function () {
	return Object.keys(pokedex).sort().filter(function (name) {
		return !simLegal || simLegal[name];
	}).map(function (name) {
		return {pokemon: name, text: name, id: name + " (Blank Set)"};
	});
};

getFirstValidSetOption = function () {
	return getSetOptions()[0];
};

getMoves = function (currentPoke, rows, x) {
	for (var i = x; i < rows.length && findSpecies(rows[i]).offset === undefined; i++) {
		if (rows[i].indexOf("Fusion: ") === 0) currentPoke.fusion = rows[i].slice(8).trim();
	}
	return simGetMoves(currentPoke, rows, x);
};

addToDex = function (poke) {
	var side = simImportSide || "p1";
	var name = poke.nameProp;
	var sets = setdex[poke.name] || {};
	for (var i = 2; sets[poke.nameProp] && sets[poke.nameProp].isCustomSet && (sets[poke.nameProp].box || "p1") !== side; i++) {
		poke.nameProp = name + " " + i;
	}
	simAddToDex(poke);
	var customSets = JSON.parse(localStorage.customsets);
	customSets[poke.name][poke.nameProp].box = side;
	if (poke.fusion) customSets[poke.name][poke.nameProp].fusion = poke.fusion;
	setdex[poke.name][poke.nameProp] = customSets[poke.name][poke.nameProp];
	localStorage.customsets = JSON.stringify(customSets);
};

loadDefaultLists = function () {
	$(".set-selector").select2({
		query: function (query) {
			var pageSize = 30;
			var results = getSetOptions().filter(function (option) {
				return option.text.toUpperCase().indexOf(query.term.toUpperCase()) >= 0;
			});
			query.callback({
				results: results.slice((query.page - 1) * pageSize, query.page * pageSize),
				more: results.length >= query.page * pageSize
			});
		},
		initSelection: function (element, callback) {
			var id = element.val();
			callback({id: id, text: id.substring(0, id.indexOf(" ("))});
		}
	});
};

calculateAllMoves = function (gen, p1, p1field, p2, p2field) {
	checkStatBoost(p1, p2);
	var results = [[], []];
	if (simSpeeds) {
		p1.stats.spe = simSpeeds[0];
		p2.stats.spe = simSpeeds[1];
	}
	for (var i = 0; i < 4; i++) {
		results[0][i] = new SimResult(p1, p2, p1.moves[i], simResults[2 * i]);
		results[1][i] = new SimResult(p2, p1, p2.moves[i], simResults[2 * i + 1]);
	}
	return results;
};

function simIcon(species, fusion) {
	var data = simMod && species && simData[simMod.id].species[species];
	var fused = data && fusion && fusion !== species && simData[simMod.id].species[fusion];
	if (fused) return '<span class="sim-icon sim-fused"><span style="' + data.icon + '"></span><span style="' + fused.icon + '"></span></span>';
	return '<span class="sim-icon" style="' + (data ? data.icon : '') + '"></span>';
}

function simItemIcon(item) {
	var data = simMod && simData[simMod.id].items[item || 'Pok\u00e9 Ball'];
	return '<span class="sim-item-icon" style="' + (data ? data.icon : '') + '"></span>';
}

function simTypeIcon(type) {
	var src = simMod && type && simData[simMod.id].typeIcons[type];
	return src ? '<img class="sim-item-type" src="' + src + '" alt="' + type + '" />' : '';
}

function showSimIcons(pokemon) {
	$("#p1, #p2").each(function (i) {
		var pokeInfo = $(this);
		var name = pokeInfo.find("input.set-selector").val() ? pokemon[i].name : '';
		pokeInfo.children("legend").find(".sim-icon").replaceWith(simIcon(name, simFusion(pokeInfo)));
		pokeInfo.find(".sim-item-button").html(simItemIcon(pokeInfo.find("select.item").val()));
	});
	$(".field-info > legend .sim-icon").each(function (i) {
		$(this).replaceWith(simIcon(SIM_FIELD_ICONS[i]));
	});
}

function showSimItems() {
	if (!simMod) return;
	var items = simData[simMod.id].items;
	var sections = {'Common': [], 'Type-Specific': [], 'Gems': [], 'Damage Reduction Berries': []};
	for (var i = 0; i < SIM_COMMON_ITEMS.length; i++) {
		if (items[SIM_COMMON_ITEMS[i]]) sections['Common'].push([SIM_COMMON_ITEMS[i], '']);
	}
	for (var name in items) {
		if (items[name].isGem) {
			sections['Gems'].push([name, items[name].typeBoost]);
		} else if (items[name].typeBoost) {
			sections['Type-Specific'].push([name, items[name].typeBoost]);
		} else if (items[name].typeResist) {
			sections['Damage Reduction Berries'].push([name, items[name].typeResist]);
		}
	}
	var buf = '';
	for (var section in sections) {
		if (!sections[section].length) continue;
		buf += (buf ? '<hr />' : '') + '<div class="sim-frame-section">' + section + '</div><div class="sim-item-list">';
		for (var j = 0; j < sections[section].length; j++) {
			var item = sections[section][j];
			buf += '<span class="sim-item" title="' + item[0] + '" data-item="' + item[0] + '">' + simItemIcon(item[0]) + simTypeIcon(item[1]) + '</span>';
		}
		buf += '</div>';
	}
	$("#sim-items .sim-frame-body").html(buf);
}

function showSimBox() {
	var customSets = localStorage.customsets ? JSON.parse(localStorage.customsets) : {};
	$(".sim-box-panel").each(function () {
		var panel = $(this);
		var side = panel.prev(".poke-info").attr("id");
		var trashed = panel.find(".sim-trash .sim-box-mon").map(function () {
			return $(this).data("set");
		}).get();
		var box = '';
		var trash = '';
		for (var species in customSets) {
			if (!setdex || !setdex[species]) continue;
			for (var name in customSets[species]) {
				var set = customSets[species][name];
				if ((set.box || "p1") !== side) continue;
				var title = species + (set.fusion ? " + " + set.fusion : "") + " (" + name + ")" + (set.item ? " @ " + set.item : "") + "&#10;" + (set.moves || []).join(" / ");
				var mon = '<span class="sim-box-mon" draggable="true" title="' + title + '" data-set="' + species + ' (' + name + ')">' +
					simIcon(species, set.fusion) + (set.item ? simItemIcon(set.item) : '') + '</span>';
				if (trashed.indexOf(species + " (" + name + ")") >= 0) {
					trash += mon;
				} else {
					box += mon;
				}
			}
		}
		panel.find(".sim-box").html(box);
		panel.find(".sim-trash").html(trash);
	});
	if (simResults) requestSimBox($(".sim-box-panel"));
}

function requestSimBox(panels) {
	panels.each(function () {
		var panel = $(this);
		var mons = panel.find(".sim-box .sim-box-mon");
		if (!mons.length || !simMod || !panel.hasClass("sim-cc-on") || simWorkerMod !== simMod) return;
		var left = panel.prev(".poke-info").attr("id") === "p1";
		var foeInfo = $(left ? "#p2" : "#p1");
		var foe = createPokemon(foeInfo);
		var field = left ? createField() : createField().swap();
		var calcs = [];
		mons.each(function () {
			var mon = createPokemon($(this).data("set"));
			for (var i = 0; i < 4; i++) {
				calcs.push(makeSimQuery(mon, foe, mon.moves[i], field, $(), foeInfo));
				calcs.push(makeSimQuery(foe, mon, foe.moves[i], field.clone().swap(), foeInfo, $()));
			}
			$(this).data({hp: mon.curHP(), foeHP: foe.curHP()});
		});
		var format = simGameType();
		delete simBoxes[panel.data("simBoxRequest")];
		simBoxRequest--;
		var request = simBoxes[simBoxRequest] = {panel: panel, keys: [], results: [], remaining: 0};
		panel.data("simBoxRequest", simBoxRequest);
		var jobs = simWorkers.map(function () {
			return [];
		});
		for (var i = 0; i < calcs.length; i++) {
			if (!calcs[i]) continue;
			var key = request.keys[i] = format + JSON.stringify(calcs[i]);
			if (simCache[key]) {
				request.results[i] = simCache[key].result;
			} else {
				jobs[request.remaining++ % jobs.length].push([i, calcs[i]]);
			}
		}
		for (var j = 0; j < simWorkers.length; j++) {
			simWorkers[j].postMessage({id: simBoxRequest, format: format, calcs: jobs[j], rangesOnly: true});
		}
		if (!request.remaining) colorSimBox(panel, request.results);
	});
}

function colorSimBox(panel, results) {
	panel.find(".sim-box .sim-box-mon").each(function (n) {
		var offense = '';
		var defense = '';
		var dealtMax = 0;
		var takenMax = 0;
		var speeds = null;
		for (var i = 0; i < 4; i++) {
			var dealt = results[8 * n + 2 * i];
			var taken = results[8 * n + 2 * i + 1];
			if (dealt && dealt.species) speeds = [dealt.species[0].speed, dealt.species[1].speed];
			if (taken && taken.species) speeds = [taken.species[1].speed, taken.species[0].speed];
			if (dealt && dealt.damage) {
				dealtMax = Math.max(dealtMax, dealt.damage[dealt.damage.length - 1] / $(this).data("foeHP"));
				if (dealt.damage[0] >= $(this).data("foeHP")) {
					offense = '1';
				} else if (!offense && dealt.damage[dealt.damage.length - 1] >= $(this).data("foeHP")) {
					offense = '2';
				}
			}
			if (taken && taken.damage) {
				takenMax = Math.max(takenMax, taken.damage[taken.damage.length - 1] / $(this).data("hp"));
				if (taken.damage[0] >= $(this).data("hp")) {
					defense = '4';
				} else if (!defense && taken.damage[taken.damage.length - 1] >= $(this).data("hp")) {
					defense = '3';
				}
			}
		}
		$(this).removeClass("sim-speed-faster sim-speed-tie sim-speed-slower");
		if (speeds) {
			$(this).addClass(speeds[0] > speeds[1] ? "sim-speed-faster" : speeds[0] === speeds[1] ? "sim-speed-tie" : "sim-speed-slower");
		}
		var code = offense + defense;
		if (takenMax * 3 < 1 && dealtMax > takenMax) code = dealtMax >= 1 ? 'WMO' : 'W';
		$(this).removeClass("sim-dmg-1 sim-dmg-2 sim-dmg-3 sim-dmg-4 sim-dmg-13 sim-dmg-14 sim-dmg-23 sim-dmg-24 sim-dmg-W sim-dmg-WMO");
		if (code) $(this).addClass("sim-dmg-" + code);
	});
}

function requestSimPresets(pokeInfo, role) {
	if (!simMod || simWorkerMod !== simMod) return;
	var data = simData[simMod.id];
	var moveNames = Object.keys(data.moves);
	var setName = pokeInfo.find("input.set-selector").val();
	var set = {
		species: setName.substring(0, setName.indexOf(" (")),
		ability: pokeInfo.find("select.ability").val(),
		level: ~~pokeInfo.find(".level").val()
	};
	if (simFusion(pokeInfo)) set.fusion = simFusion(pokeInfo);
	var pools = [data.pools[set.species], data.pools[set.fusion]].filter(Boolean);
	var names = function (i) {
		return [].concat.apply([], pools.map(function (pool) {
			return pool[i];
		})).map(function (move) {
			return moveNames[move];
		});
	};
	simPresetRequest--;
	pokeInfo.data({simPresetRequest: simPresetRequest, simPresetRole: role});
	simWorkers[0].postMessage({
		id: simPresetRequest, side: pokeInfo.attr("id"), format: simGameType(),
		presets: {set: set, usable: names(0), other: names(1)}
	});
}

function requestSimFusionPresets(pokeInfo) {
	var role = pokeInfo.find("select.spread").val();
	var presets = pokeInfo.data("simPresets");
	showSimSets(pokeInfo, pokeInfo.find("select.set").val());
	requestSimPresets(pokeInfo, pokeInfo.data("simPresetAuto") || (presets && presets.sets[role] ? role : ''));
}

function showSimSets(pokeInfo, value) {
	if (!simMod) return;
	var items = simData[simMod.id].items;
	var setName = pokeInfo.find("input.set-selector").val();
	var names = [setName.substring(0, setName.indexOf(" (")), simFusion(pokeInfo)];
	var grouped = names[1] && names[1] !== names[0];
	var options = '<option value="">(none)</option>';
	for (var i = 0; i < names.length; i++) {
		if (!setdex[names[i]] || names.indexOf(names[i]) < i) continue;
		if (grouped) options += '<optgroup label="' + names[i] + '">';
		for (var set in setdex[names[i]]) {
			var item = items[setdex[names[i]][set].item];
			if (item && item.megaStone && item.megaStone[names[i]] && !setdex[names[i]][set].isCustomSet) continue;
			options += '<option value="' + names[i] + ' (' + set + ')"' + (setdex[names[i]][set].isCustomSet ? ' class="sim-custom"' : '') + '>' + set + '</option>';
		}
		if (grouped) options += '</optgroup>';
	}
	pokeInfo.find("select.set").html(options).val(value);
	if (!pokeInfo.find("select.set").val()) pokeInfo.find("select.set").val("");
}

function showSimSpreads(pokeInfo) {
	var current = pokeInfo.find("select.spread").val();
	var sets = (pokeInfo.data("simPresets") || {sets: {}}).sets;
	var options = '';
	for (var role in sets) {
		options += '<option value="' + role + '">' + role + ': ' + sets[role].label + '</option>';
	}
	options += '<option value="Blank Set">Blank Set</option>';
	pokeInfo.find("select.spread").html(options).val(current);
	if (!current) pokeInfo.find("select.spread").prop("selectedIndex", -1);
}

function applySimSet(pokeInfo, value) {
	var species = value.substring(0, value.indexOf(" ("));
	var set = correctHiddenPower(setdex[species][value.substring(value.indexOf("(") + 1, value.lastIndexOf(")"))]);
	pokeInfo.data("simPresetAuto", false);
	pokeInfo.find("select.spread").prop("selectedIndex", -1);
	if (set.isCustomSet) {
		pokeInfo.find("select.fusion").select2("val", set.fusion || pokeInfo.find("select.fusion").val());
		pokeInfo.find(".sim-fusion").toggleClass("sim-open", !!set.fusion);
		if (!set.fusion) restoreSimSpecies(pokeInfo);
		requestSimFusionPresets(pokeInfo);
	}
	pokeInfo.find(".level").val(set.level === undefined ? 100 : set.level);
	for (var stat in SIM_STATS) {
		pokeInfo.find("." + SIM_STATS[stat] + " .evs").val(set.evs && set.evs[SIM_STATS[stat]] || 0);
		pokeInfo.find("." + SIM_STATS[stat] + " .ivs").val(set.ivs && set.ivs[SIM_STATS[stat]] !== undefined ? set.ivs[SIM_STATS[stat]] : 31);
	}
	setSelectValueIfValid(pokeInfo.find(".nature"), set.nature, "Hardy");
	setSelectValueIfValid(pokeInfo.find("select.ability"), set.ability, pokeInfo.find("select.ability").val());
	pokeInfo.find("select.ability").change();
	setSelectValueIfValid(pokeInfo.find("select.item"), set.item, "");
	pokeInfo.find("select.item").change();
	setSelectValueIfValid(pokeInfo.find(".teraType"), set.teraType, pokeInfo.find(".teraType").val());
	for (var i = 0; i < 4; i++) {
		var move = pokeInfo.find(".move" + (i + 1) + " select.move-selector");
		setSelectValueIfValid(move, set.moves && set.moves[i], "(No Move)");
		move.change();
	}
	calcHP(pokeInfo);
	calcStats(pokeInfo);
	totalEVs(pokeInfo);
	PC_HANDLER();
}

function applySimPreset(pokeInfo, role) {
	var presets = pokeInfo.data("simPresets");
	var set = presets && presets.sets[role] || {evs: {}, nature: "Hardy", item: "", moves: []};
	pokeInfo.data("simPresetAuto", presets && role === presets.role);
	pokeInfo.find("select.set").val("");
	pokeInfo.find("select.spread").val(role);
	for (var stat in SIM_STATS) {
		pokeInfo.find("." + SIM_STATS[stat] + " .evs").val(set.evs[stat] || 0);
	}
	pokeInfo.find(".nature").val(set.nature);
	pokeInfo.find("select.item").val(set.item).change();
	for (var i = 0; i < 4; i++) {
		pokeInfo.find(".move" + (i + 1) + " select.move-selector").val(set.moves[i] || "(No Move)").change();
	}
	calcHP(pokeInfo);
	calcStats(pokeInfo);
	totalEVs(pokeInfo);
	PC_HANDLER();
}

function makeSimFrame(id, title, body) {
	var frame = $(
		'<div class="sim-frame" id="' + id + '" hidden><div class="sim-frame-header"><span>' + title + '</span>' +
		'<span class="sim-frame-close">X</span></div><div class="sim-frame-body">' + body + '</div></div>'
	).appendTo("body");
	frame.find(".sim-frame-close").click(function () {
		frame.prop("hidden", true);
	});
	frame.find(".sim-frame-header").mousedown(function (event) {
		var offset = frame.offset();
		var x = event.pageX - offset.left;
		var y = event.pageY - offset.top;
		$(document).on("mousemove.simframe", function (moveEvent) {
			frame.css({left: moveEvent.pageX - x, top: moveEvent.pageY - y});
		}).one("mouseup", function () {
			$(document).off("mousemove.simframe");
		});
		event.preventDefault();
	});
	return frame;
}

$("header .nav a").each(function (i) {
	$(this).attr("href", SIM_NAV[i]);
});
$("header .nav img").attr({src: SIM_LOGO + ".png", srcset: SIM_LOGO + ".png 1x, " + SIM_LOGO + "@2x.png 2x"});
$("header").addClass("sim-header");
$("#p1, #p2").children("legend").append(simIcon());
$(".field-info > legend").prepend(simIcon()).append(simIcon());
$(".poke-info input.set-selector").after(
	"<div class=\"sim-fusion\"><button class=\"sim-fusion-button\" title=\"Fusion\"><img src=\"//" + SIM_CLIENT + "/fx/fused.png\" alt=\"Fusion\" /></button>" +
	"<select class=\"fusion calc-trigger\"></select></div>" +
	"<div class=\"sim-set\"><label>Set</label><select class=\"set\"></select><input class=\"sim-set-name\" placeholder=\"Set name\" />" +
	"<div class=\"sim-saved\"></div><button class=\"sim-save-button\" hidden>Save</button><button class=\"sim-new-button\">Save as New</button>" +
	"<button class=\"sim-name-button\">Save</button><button class=\"sim-cancel-button\">Cancel</button></div>" +
	"<div class=\"sim-spread\"><label>Spread</label><select class=\"spread\"></select></div>"
);
$(".poke-info select.ability").parent().after(
	"<div class=\"sim-ability2 hide\"><label>Ability 2</label> <select class=\"ability2 calc-trigger\"></select> " +
	"<input hidden type=\"checkbox\" title=\"Is this ability active?\" class=\"ability2Toggle calc-trigger\" /></div>"
);
$(".poke-info select.item").after("<button class=\"sim-item-button\"></button>");
$("#p1, #p2").after(
	"<fieldset class=\"sim-box-panel\"><div class=\"sim-box-label\">Box</div><div class=\"sim-box-list sim-box\"></div><hr />" +
	"<div class=\"sim-cc\"><div class=\"sim-box-label\">Color Codes</div><button class=\"sim-cc-show\">Show</button>" +
	"<button class=\"sim-cc-hide\" hidden>Hide</button><button class=\"sim-cc-refresh\" hidden>Refresh</button>" +
	"<button class=\"sim-cc-info\" hidden>Color Code Explanation</button><div class=\"sim-cc-legend\" hidden></div>" +
	"<div class=\"sim-cc-settings\" hidden><label><input type=\"checkbox\" class=\"sim-cc-speed\" checked />speed border</label>" +
	"<label><input type=\"checkbox\" class=\"sim-cc-dmg\" checked />OHKO color</label>" +
	"<label><input type=\"checkbox\" class=\"sim-cc-auto\" checked />auto-refresh</label>" +
	"<label><input type=\"range\" class=\"sim-cc-width\" min=\"1\" max=\"5\" value=\"2\" />Speed Border width</label></div></div><hr />" +
	"<div class=\"sim-box-label\">Trash</div><div class=\"sim-box-list sim-trash\"></div>" +
	"<button class=\"sim-clear-box\">Remove Pok&eacute;mon from the box</button>" +
	"<button class=\"sim-clear-trash\">Remove Pok&eacute;mon from the trash</button></fieldset>"
);
$(".field-info").closest("[role='region']").after(
	"<div role=\"region\"><fieldset class=\"sim-notes-panel\"><legend>Note</legend>" +
	"<button id=\"sim-open-notes\">Open Notes</button></fieldset></div>"
);
$("[aria-labelledby='selectWeatherInstruction']").append("<div class=\"sim-weather sim-conditions\"></div>");
$("[aria-labelledby='selectTerrainInstruction']").append("<span class=\"sim-terrain sim-conditions\"></span>");
$("#gravity").parent().after("<div class=\"sim-field sim-conditions\"></div>");
$("#default-level-100").before(
	"<input class=\"visually-hidden calc-trigger\" type=\"radio\" name=\"defaultLevel\" value=\"120\" id=\"default-level-120\" />" +
	"<label class=\"btn btn-wide btn-left\" for=\"default-level-120\">Level 120</label>"
).next("label").removeClass("btn-left").addClass("btn-mid");
$(".genSelection, .notationSelection, .modeSelection").hide();
$(".main-title-text").text("Mod Selector:").after("<select id=\"sim-mod\"></select>");
for (var simCodeGroup in SIM_COLOR_CODES) {
	$(".sim-cc-legend").append("<div class=\"sim-box-label\">" + simCodeGroup + "</div>");
	for (var simCode in SIM_COLOR_CODES[simCodeGroup]) {
		$(".sim-cc-legend").append("<div><span class=\"sim-cc-swatch " + simCode + "\"></span>" + SIM_COLOR_CODES[simCodeGroup][simCode] + "</div>");
	}
}
$(".sim-cc-legend").append("<p>Color coding is intended to help, though some caveats and quirks are missed.</p>");
makeSimFrame("sim-items", "Items", "");
makeSimFrame("sim-notes", "Notes", "<textarea id=\"sim-notes-text\" cols=\"30\" rows=\"10\"></textarea>");
for (var simGen in SIM_SETDEX) {
	for (var simSpecies in SIM_SETDEX[simGen]) {
		SETDEX[simGen][simSpecies] = $.extend({}, SETDEX[simGen][simSpecies], SIM_SETDEX[simGen][simSpecies]);
	}
}

$("#default-level-120").change(function () {
	$("#default-level-100").triggerHandler("change");
});

$("select.fusion").change(function () {
	if (!$(this).val()) restoreSimSpecies($(this).closest(".poke-info"));
});

$("select.ability2").change(function () {
	var toggle = SIM_ABILITY_TOGGLES[$(this).val()];
	$(this).siblings(".ability2Toggle").prop({hidden: toggle === undefined, checked: !!toggle});
});

$(".sim-fusion-button").click(function () {
	var fusion = $(this).parent().toggleClass("sim-open");
	if (!fusion.find("select.fusion").val()) return;
	if (!fusion.hasClass("sim-open")) restoreSimSpecies(fusion.closest(".poke-info"));
	requestSimFusionPresets(fusion.closest(".poke-info"));
	PC_HANDLER();
});

$(".sim-new-button").click(function () {
	var pokeInfo = $(this).closest(".poke-info");
	var name = createPokemon(pokeInfo).name;
	var base = [pokeInfo.find(".nature").val(), pokeInfo.find("select.item").val()].join(" ").trim() || "Custom Set";
	var set = base;
	for (var i = 2; setdex[name] && setdex[name][set]; i++) set = base + " " + i;
	pokeInfo.find(".sim-set").addClass("sim-naming").find(".sim-set-name").val(set).select();
});

$(".sim-cancel-button").click(function () {
	$(this).closest(".sim-set").removeClass("sim-naming");
});

$(".sim-set-name").keydown(function (event) {
	if (event.key === "Enter") $(this).siblings(".sim-name-button").click();
	if (event.key === "Escape") $(this).siblings(".sim-cancel-button").click();
});

$(".sim-save-button, .sim-name-button").click(function () {
	var pokeInfo = $(this).closest(".poke-info");
	var side = pokeInfo.attr("id");
	var name = createPokemon(pokeInfo).name;
	var setName = pokeInfo.find("select.set").val();
	var set = setName.substring(setName.indexOf("(") + 1, setName.lastIndexOf(")"));
	var isNew = $(this).hasClass("sim-name-button");
	if (isNew) {
		var base = pokeInfo.find(".sim-set-name").val().replace(/["<>]/g, "").trim() || "Custom Set";
		set = base;
		for (var i = 2; setdex[name] && setdex[name][set]; i++) set = base + " " + i;
	}
	ExportPokemon(pokeInfo);
	$(".import-name-text").val(set);
	simImportSide = !isNew && setdex[name] && setdex[name][set] ? setdex[name][set].box || "p1" : side;
	$("#import.bs-btn").click();
	simImportSide = null;
	if (simFusion(pokeInfo)) setdex[name][set].fusion = simFusion(pokeInfo);
	var customSets = JSON.parse(localStorage.customsets);
	customSets[name][set] = setdex[name][set];
	var saved = set;
	for (var other in customSets[name]) {
		if (!isNew || other === set || (customSets[name][other].box || "p1") !== side) continue;
		if (JSON.stringify($.extend({}, customSets[name][other], {box: side})) === JSON.stringify(customSets[name][set])) saved = other;
	}
	if (saved !== set) {
		delete customSets[name][set];
		delete setdex[name][set];
	}
	localStorage.customsets = JSON.stringify(customSets);
	pokeInfo.find(".sim-set").removeClass("sim-naming");
	pokeInfo.find(".sim-save-button").prop("hidden", true);
	showSimSets(pokeInfo, name + " (" + saved + ")");
	showSimBox();
	pokeInfo.find(".sim-saved").text(saved === set ? "Saved!" : "Already saved as " + saved).show();
	setTimeout(function () {
		pokeInfo.find(".sim-saved").hide();
	}, 1500);
});

$(".sim-item-button").click(function () {
	simItemSide = $(this).closest(".poke-info");
	var offset = $(this).offset();
	var frame = $("#sim-items").prop("hidden", false);
	frame.css({
		left: Math.max(0, Math.min(offset.left, $(window).width() - frame.outerWidth())),
		top: offset.top + $(this).outerHeight()
	});
});

$("#sim-items").on("click", ".sim-item", function () {
	if (!simItemSide) return;
	simItemSide.find("select.item").val($(this).data("item")).change();
	simItemSide.find(".sim-save-button").prop("hidden", !simItemSide.find("select.set option:selected").hasClass("sim-custom"));
});

$("#sim-open-notes").click(function () {
	$("#sim-notes").prop("hidden", false);
});

$("#sim-notes-text").on("input", function () {
	localStorage.setItem("notes", $(this).val());
});

$(".sim-box-panel").on("click", ".sim-box-mon", function () {
	var set = $(this).data("set");
	$(this).closest(".sim-box-panel").prev(".poke-info").find("input.set-selector").val(set).change().select2("data", {id: set, text: set});
}).on("dragstart", ".sim-box-mon", function (event) {
	event.originalEvent.dataTransfer.setData("text/plain", $(this).data("set"));
}).on("dragover", ".sim-box-list", function (event) {
	event.preventDefault();
	$(this).addClass("sim-over");
}).on("dragleave drop", ".sim-box-list", function () {
	$(this).removeClass("sim-over");
}).on("drop", ".sim-box-list", function (event) {
	event.preventDefault();
	var set = event.originalEvent.dataTransfer.getData("text/plain");
	var mon = $(".sim-box-mon").filter(function () {
		return $(this).data("set") === set;
	});
	var panel = $(this).closest(".sim-box-panel");
	var panels = mon.closest(".sim-box-panel").add(panel);
	if (panels.length > 1) {
		var customSets = JSON.parse(localStorage.customsets);
		customSets[set.substring(0, set.indexOf(" ("))][set.substring(set.indexOf("(") + 1, set.lastIndexOf(")"))].box = panel.prev(".poke-info").attr("id");
		localStorage.customsets = JSON.stringify(customSets);
		mon.attr("class", "sim-box-mon");
	}
	var target = $(event.target).closest(".sim-box-mon");
	if (target.length && target[0] !== mon[0]) {
		target.before(mon);
	} else {
		$(this).append(mon);
	}
	requestSimBox(panels);
});

$(".sim-cc-show, .sim-cc-hide").click(function () {
	var panel = $(this).closest(".sim-box-panel").toggleClass("sim-cc-on", $(this).hasClass("sim-cc-show"));
	panel.find(".sim-cc-show, .sim-cc-hide, .sim-cc-refresh, .sim-cc-info, .sim-cc-settings").each(function () {
		this.hidden = !this.hidden;
	});
	panel.find(".sim-cc-legend").prop("hidden", true);
	panel.find(".sim-box .sim-box-mon").attr("class", "sim-box-mon");
	requestSimBox(panel);
});

$(".sim-cc-refresh").click(function () {
	requestSimBox($(this).closest(".sim-box-panel"));
});

$(".sim-cc-info").click(function () {
	var legend = $(this).siblings(".sim-cc-legend");
	legend.prop("hidden", !legend.prop("hidden"));
});

$(".sim-cc-speed, .sim-cc-dmg").change(function () {
	$(this).closest(".sim-box-panel").toggleClass(this.className + "-off", !this.checked);
});

$(".sim-cc-auto").change(function () {
	if (this.checked) requestSimBox($(this).closest(".sim-box-panel"));
});

$(".sim-cc-width").on("input change", function () {
	$(this).closest(".sim-box-panel")[0].style.setProperty("--sim-speed-width", this.value + "px");
});

$(".sim-clear-box, .sim-clear-trash").click(function () {
	var mons = $(this).closest(".sim-box-panel").find($(this).hasClass("sim-clear-box") ? ".sim-box .sim-box-mon" : ".sim-trash .sim-box-mon");
	if (!mons.length || !confirm("Do you really want to remove " + (mons.length > 1 ? mons.length + " Pokémon" : "this Pokémon") + "?")) return;
	var customSets = JSON.parse(localStorage.customsets);
	mons.each(function () {
		var set = $(this).data("set");
		var species = set.substring(0, set.indexOf(" ("));
		delete customSets[species][set.substring(set.indexOf("(") + 1, set.lastIndexOf(")"))];
		if ($.isEmptyObject(customSets[species])) delete customSets[species];
		if (setdex[species]) delete setdex[species][set.substring(set.indexOf("(") + 1, set.lastIndexOf(")"))];
	});
	localStorage.customsets = JSON.stringify(customSets);
	showSimBox();
});

$(document).on("click", "#import", function () {
	setTimeout(showSimBox, 0);
});

$(document).on("click", ".sim-import-right", function () {
	simImportSide = "p2";
	$("#import").click();
	simImportSide = null;
});

$(document).on("click", "input[name='weather']", function () {
	simManualWeather = true;
});

$(document).on("click", "input[name='terrain']", function () {
	simManualTerrain = true;
});

$(".result-move").click(function () {
	simSelectedMove = this.id;
});

$(".set-selector").change(function () {
	var pokeInfo = $(this).closest(".poke-info");
	simSelectedMove = null;
	pokeInfo.find(".sim-save-button").prop("hidden", true);
	pokeInfo.find(".sim-set").removeClass("sim-naming");
	pokeInfo.data("simPresets", null).find("select.spread").prop("selectedIndex", -1);
	var setName = $(this).val();
	var set = setdex[setName.substring(0, setName.indexOf(" ("))];
	set = set && set[setName.substring(setName.indexOf("(") + 1, setName.lastIndexOf(")"))];
	if (set && set.isCustomSet) {
		pokeInfo.find("select.fusion").select2("val", set.fusion || pokeInfo.find("select.fusion").val());
		pokeInfo.find(".sim-fusion").toggleClass("sim-open", !!set.fusion);
	}
	showSimSets(pokeInfo, $(this).val());
	showSimSpreads(pokeInfo);
	requestSimPresets(pokeInfo, / \(Blank Set\)$/.test($(this).val()));
});

$("select.set").change(function () {
	var pokeInfo = $(this).closest(".poke-info");
	var setName = pokeInfo.find("input.set-selector").val();
	var species = setName.substring(0, setName.indexOf(" ("));
	if ($(this).val()) {
		applySimSet(pokeInfo, $(this).val());
	} else {
		pokeInfo.find("input.set-selector").val(species + " (Blank Set)").change().select2("data", {id: species + " (Blank Set)", text: species});
	}
});

$("select.spread").change(function () {
	applySimPreset($(this).closest(".poke-info"), $(this).val());
});

$(".poke-info").on("change input", ".forme, .level, .gender, .evs, .ivs, .dvs, .nature, .ability, .item, .teraType, .gmaxToggle, .move-selector", function (event) {
	if (event.target === this && (event.originalEvent || event.added)) {
		var pokeInfo = $(this).closest(".poke-info");
		pokeInfo.find(".sim-save-button").prop("hidden", !pokeInfo.find("select.set option:selected").hasClass("sim-custom"));
	}
});

$(".set-selector, select.ability").change(function () {
	simManualWeather = false;
	simManualTerrain = false;
});

$("select.fusion").change(function () {
	if ($(this).val()) $(this).closest(".sim-fusion").addClass("sim-open");
	requestSimFusionPresets($(this).closest(".poke-info"));
});

$("#sim-mod").change(function () {
	loadSimMod($(this).val());
});

$(document).ready(function () {
	if (localStorage.getItem('darkTheme') === null) {
		prefersDarkTheme = 'true';
		$("#dark-theme-toggle").val('true');
	}
	var upstreamUpdateTheme = updateTheme;
	updateTheme = function () {
		upstreamUpdateTheme();
		$("html").toggleClass("sim-dark", !document.getElementById("dark-theme-styles").disabled);
	};
	updateTheme();
	$("#sim-notes-text").val(localStorage.getItem("notes") || "");
	$("#import").text("Import to Left").after(" <button class=\"bs-btn bs-btn-default sim-import-right\">Import to Right</button>");
	$("select.fusion").select2({dropdownAutoWidth: true, width: '100%'});
	$.ajax({url: "./sim-data/mods.json", dataType: "json", cache: false}).done(function (mods) {
		var sections = {};
		for (var i = 0; i < mods.length; i++) {
			simMods[mods[i].id] = mods[i];
			(sections[mods[i].section] = sections[mods[i].section] || []).push(mods[i]);
		}
		var options = '';
		for (var section in sections) {
			options += '<optgroup label="' + section + '">';
			for (var j = 0; j < sections[section].length; j++) {
				options += '<option value="' + sections[section][j].id + '">' + sections[section][j].id + '</option>';
			}
			options += '</optgroup>';
		}
		var id = SIM_PARAMS.get('mod');
		$("#sim-mod").html(options).val(simMods[id] ? id : simMods[SIM_DEFAULT_MOD] ? SIM_DEFAULT_MOD : mods[0].id).change();
	});
});
