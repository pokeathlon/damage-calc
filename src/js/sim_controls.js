/*global performCalculations: true, calculateAllMoves: true, getSetOptions: true, getFirstValidSetOption: true, loadDefaultLists: true, updateTheme: true, prefersDarkTheme: true, getSelectOptions, calcHP, calcStats, checkStatBoost, PC_HANDLER, ExportPokemon, setdex, totalEVs */
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
var simWorker = null;
var simRequest = 0;
var simBoxRequest = 0;
var simPresetRequest = 0;
var simManualWeather = false;
var simManualTerrain = false;
var simItemSide = null;
var simSelectedMove = null;
var simColorCodes = false;
var simGetGeneration = calc.Generations.get;
var simPerformCalculations = performCalculations;

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
	if (!simMod || simMod.id !== mod.id) loadSimWorker(mod.id);
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
	if (simData[id]) return installSimData(simMods[id], simData[id]);
	$.getJSON("./sim-data/" + id + ".json", function (data) {
		simData[id] = data;
		if ($("#sim-mod").val() === id) installSimData(simMods[id], data);
	});
}

function loadSimWorker(mod) {
	if (simWorker) simWorker.terminate();
	simWorker = new Worker("./sim-data/" + mod + ".js");
	simWorker.onmessage = function (event) {
		var response = event.data;
		if (response.side) {
			var pokeInfo = $("#" + response.side);
			if (pokeInfo.data("simPresetRequest") !== response.id) return;
			var role = pokeInfo.data("simPresetRole") === true ? response.presets && response.presets.role : pokeInfo.data("simPresetRole");
			pokeInfo.data("simPresets", response.presets);
			showSimSpreads(pokeInfo);
			if (role) applySimPreset(pokeInfo, response.presets && response.presets.sets[role] ? role : "Blank Set");
		} else if (response.id === simRequest && response.speeds) {
			simSpeeds = response.speeds;
			$("#p1 .sp .totalMod").text(simSpeeds[0]);
			$("#p2 .sp .totalMod").text(simSpeeds[1]);
		} else if (response.id === simRequest) {
			simResults = response.results;
			showSimField();
			showSimSpecies($("#p1"), 0);
			showSimSpecies($("#p2"), 1);
			simPerformCalculations();
			if (simSelectedMove && !$(".locked-move").length) $("#" + simSelectedMove).prop("checked", true).change();
			if (response.full && $("#sim-cc-auto").prop("checked")) requestSimBox();
		} else if (response.id === simBoxRequest && simColorCodes) {
			colorSimBox(response.results);
		}
	};
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
	var attackerSide = attackerInfo.attr("id") === "p2" ? "right" : "left";
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
	return this.data.description + ': ' + damage + (this.data.ko ? ' -- ' + this.data.ko : '');
};

SimResult.prototype.desc = function () {
	return this.fullDesc('%');
};

performCalculations = function () {
	if (!simMod) return;
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
	simRequest++;
	simSpeeds = null;
	simWorker.postMessage({
		id: simRequest, format: simGameType(), calcs: calcs, speed: makeSimQuery(p1, p2, {}, p1field, p1info, p2info)
	});
	showSimIcons();
};

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

function simIcon(species) {
	var data = simMod && species && simData[simMod.id].species[species];
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

function showSimIcons() {
	$("#p1, #p2").each(function () {
		var pokeInfo = $(this);
		var name = pokeInfo.find("input.set-selector").val() ? createPokemon(pokeInfo).name : '';
		pokeInfo.children("legend").find(".sim-icon").replaceWith(simIcon(name));
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

function simBoxSets() {
	var sets = [];
	var customSets = localStorage.customsets ? JSON.parse(localStorage.customsets) : {};
	for (var species in customSets) {
		if (!setdex || !setdex[species]) continue;
		for (var set in customSets[species]) sets.push(species + " (" + set + ")");
	}
	return sets;
}

function showSimBox() {
	var sets = simBoxSets();
	var trashed = $("#sim-trash .sim-box-mon").map(function () {
		return $(this).data("set");
	}).get();
	var box = '';
	var trash = '';
	for (var i = 0; i < sets.length; i++) {
		var mon = '<span class="sim-box-mon" draggable="true" title="' + sets[i] + '" data-set="' + sets[i] + '">' +
			simIcon(sets[i].substring(0, sets[i].indexOf(" ("))) + '</span>';
		if (trashed.indexOf(sets[i]) >= 0) {
			trash += mon;
		} else {
			box += mon;
		}
	}
	$("#sim-box").html(box);
	$("#sim-trash").html(trash);
	if (simResults) requestSimBox();
}

function requestSimBox() {
	var mons = $("#sim-box .sim-box-mon");
	if (!mons.length || !simMod || !simColorCodes) return;
	var p2info = $("#p2");
	var p2 = createPokemon(p2info);
	var field = createField();
	var calcs = [];
	mons.each(function () {
		var mon = createPokemon($(this).data("set"));
		for (var i = 0; i < 4; i++) {
			calcs.push(makeSimQuery(mon, p2, mon.moves[i], field, $(), p2info));
			calcs.push(makeSimQuery(p2, mon, p2.moves[i], field.clone().swap(), p2info, $()));
		}
		$(this).data({hp: mon.curHP(), foeHP: p2.curHP()});
	});
	simBoxRequest--;
	simWorker.postMessage({id: simBoxRequest, format: simGameType(), calcs: calcs, rangesOnly: true});
}

function colorSimBox(results) {
	$("#sim-box .sim-box-mon").each(function (n) {
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
	if (!simMod || !simWorker) return;
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
	simWorker.postMessage({
		id: simPresetRequest, side: pokeInfo.attr("id"), format: simGameType(),
		presets: {set: set, usable: names(0), other: names(1)}
	});
}

function requestSimFusionPresets(pokeInfo) {
	var role = pokeInfo.find("select.spread").val();
	var presets = pokeInfo.data("simPresets");
	requestSimPresets(pokeInfo, pokeInfo.data("simPresetAuto") || (presets && presets.sets[role] ? role : ''));
}

function showSimSpreads(pokeInfo) {
	var setName = pokeInfo.find("input.set-selector").val();
	var set = setName.substring(setName.indexOf("(") + 1, setName.lastIndexOf(")"));
	var current = pokeInfo.find("select.spread").val() || set;
	var sets = (pokeInfo.data("simPresets") || {sets: {}}).sets;
	var options = set === "Blank Set" ? '' : '<option value="' + set + '">' + set + '</option>';
	for (var role in sets) {
		options += '<option value="' + role + '">' + role + ': ' + sets[role].label + '</option>';
	}
	options += '<option value="Blank Set">Blank Set</option>';
	pokeInfo.find("select.spread").html(options).val(current);
	if (!pokeInfo.find("select.spread").val()) pokeInfo.find("select.spread").val(set);
}

function applySimPreset(pokeInfo, role) {
	var presets = pokeInfo.data("simPresets");
	var set = presets && presets.sets[role] || {evs: {}, nature: "Hardy", item: "", moves: []};
	pokeInfo.data("simPresetAuto", presets && role === presets.role);
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
	"<div class=\"sim-spread\"><label>Spread</label><select class=\"spread\"></select>" +
	"<div class=\"sim-saved\">Saved!</div><button class=\"sim-save-button\" hidden>Save Changes</button></div>"
);
$(".poke-info select.ability").parent().after(
	"<div class=\"sim-ability2 hide\"><label>Ability 2</label> <select class=\"ability2 calc-trigger\"></select> " +
	"<input hidden type=\"checkbox\" title=\"Is this ability active?\" class=\"ability2Toggle calc-trigger\" /></div>"
);
$(".poke-info select.item").after("<button class=\"sim-item-button\"></button>");
$("#p1").after(
	"<fieldset class=\"sim-box-panel\"><div class=\"sim-box-label\">Box</div><div class=\"sim-box-list\" id=\"sim-box\"></div><hr />" +
	"<div class=\"sim-cc\"><div class=\"sim-box-label\">Color Codes</div><button id=\"sim-cc-show\">Show</button>" +
	"<button id=\"sim-cc-hide\" hidden>Hide</button><button id=\"sim-cc-refresh\" hidden>Refresh</button>" +
	"<button id=\"sim-cc-info\" hidden>Color Code Explanation</button><div id=\"sim-cc-legend\" hidden></div>" +
	"<div id=\"sim-cc-settings\" hidden><label><input type=\"checkbox\" id=\"sim-cc-speed\" checked />speed border</label>" +
	"<label><input type=\"checkbox\" id=\"sim-cc-dmg\" checked />OHKO color</label>" +
	"<label><input type=\"checkbox\" id=\"sim-cc-auto\" checked />auto-refresh</label>" +
	"<label><input type=\"range\" id=\"sim-cc-width\" min=\"1\" max=\"5\" value=\"2\" />Speed Border width</label></div></div><hr />" +
	"<div class=\"sim-box-label\">Trash</div><div class=\"sim-box-list\" id=\"sim-trash\"></div>" +
	"<button id=\"sim-clear-box\">Remove Pok&eacute;mon from the box</button>" +
	"<button id=\"sim-clear-trash\">Remove Pok&eacute;mon from the trash</button></fieldset>"
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
	$("#sim-cc-legend").append("<div class=\"sim-box-label\">" + simCodeGroup + "</div>");
	for (var simCode in SIM_COLOR_CODES[simCodeGroup]) {
		$("#sim-cc-legend").append("<div><span class=\"sim-cc-swatch " + simCode + "\"></span>" + SIM_COLOR_CODES[simCodeGroup][simCode] + "</div>");
	}
}
$("#sim-cc-legend").append("<p>Color coding is intended to help, though some caveats and quirks are missed.</p>");
makeSimFrame("sim-items", "Items", "");
makeSimFrame("sim-notes", "Notes", "<textarea id=\"sim-notes-text\" cols=\"30\" rows=\"10\"></textarea>");

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

$(".sim-save-button").click(function () {
	var pokeInfo = $(this).closest(".poke-info");
	$(this).prop("hidden", true);
	var setName = pokeInfo.find("input.set-selector").val();
	var name = setName.substring(0, setName.indexOf(" ("));
	var set = setName.substring(setName.indexOf("(") + 1, setName.lastIndexOf(")"));
	ExportPokemon(pokeInfo);
	$(".import-name-text").val(setdex[name] && setdex[name][set] && setdex[name][set].isCustomSet ? set : "Custom Set");
	$("#import.bs-btn").click();
	showSimBox();
	pokeInfo.find(".sim-saved").show();
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
	simItemSide.find(".sim-save-button").prop("hidden", false);
});

$("#sim-open-notes").click(function () {
	$("#sim-notes").prop("hidden", false);
});

$("#sim-notes-text").on("input", function () {
	localStorage.setItem("notes", $(this).val());
});

$(".sim-box-panel").on("click", ".sim-box-mon", function () {
	var set = $(this).data("set");
	$("#p1 input.set-selector").val(set).change().select2("data", {id: set, text: set});
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
	var target = $(event.target).closest(".sim-box-mon");
	if (target.length && target[0] !== mon[0]) {
		target.before(mon);
	} else {
		$(this).append(mon);
	}
	requestSimBox();
});

$("#sim-cc-show, #sim-cc-hide").click(function () {
	simColorCodes = this.id === "sim-cc-show";
	$("#sim-cc-show, #sim-cc-hide, #sim-cc-refresh, #sim-cc-info, #sim-cc-settings").each(function () {
		this.hidden = !this.hidden;
	});
	$("#sim-cc-legend").prop("hidden", true);
	$("#sim-box .sim-box-mon").attr("class", "sim-box-mon");
	requestSimBox();
});

$("#sim-cc-refresh").click(requestSimBox);

$("#sim-cc-info").click(function () {
	$("#sim-cc-legend").prop("hidden", !$("#sim-cc-legend").prop("hidden"));
});

$("#sim-cc-speed, #sim-cc-dmg").change(function () {
	$(".sim-box-panel").toggleClass(this.id + "-off", !this.checked);
});

$("#sim-cc-auto").change(function () {
	if (this.checked) requestSimBox();
});

$("#sim-cc-width").on("input change", function () {
	$(".sim-box-panel")[0].style.setProperty("--sim-speed-width", this.value + "px");
});

$("#sim-clear-box").click(function () {
	$("#clearSets").click();
	showSimBox();
});

$("#sim-clear-trash").click(function () {
	var trashed = $("#sim-trash .sim-box-mon");
	if (!trashed.length || !confirm("Do you really want to remove " + (trashed.length > 1 ? trashed.length + " Pokémon" : "this Pokémon") + "?")) return;
	var customSets = JSON.parse(localStorage.customsets);
	trashed.each(function () {
		var set = $(this).data("set");
		var species = set.substring(0, set.indexOf(" ("));
		delete customSets[species][set.substring(set.indexOf("(") + 1, set.lastIndexOf(")"))];
		if ($.isEmptyObject(customSets[species])) delete customSets[species];
		if (setdex[species]) delete setdex[species][set.substring(set.indexOf("(") + 1, set.lastIndexOf(")"))];
	});
	localStorage.customsets = JSON.stringify(customSets);
	$("#sim-trash").empty();
	showSimBox();
});

$(document).on("click", "#import", function () {
	setTimeout(showSimBox, 0);
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
	pokeInfo.data("simPresets", null).find("select.spread").val("");
	showSimSpreads(pokeInfo);
	requestSimPresets(pokeInfo, / \(Blank Set\)$/.test($(this).val()));
});

$("select.spread").change(function () {
	var pokeInfo = $(this).closest(".poke-info");
	var setName = pokeInfo.find("input.set-selector").val();
	if ($(this).val() !== "Blank Set" && setName.substring(setName.indexOf("(") + 1, setName.lastIndexOf(")")) === $(this).val()) {
		pokeInfo.find("input.set-selector").change();
	} else {
		applySimPreset(pokeInfo, $(this).val());
	}
});

$(".poke-info").on("change input", ".forme, .level, .gender, .evs, .ivs, .dvs, .nature, .ability, .item, .teraType, .gmaxToggle, .move-selector", function (event) {
	if (event.target === this && (event.originalEvent || event.added)) {
		$(this).closest(".poke-info").find(".sim-save-button").prop("hidden", false);
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
	$("select.fusion").select2({dropdownAutoWidth: true, width: '100%'});
	$.getJSON("./sim-data/mods.json", function (mods) {
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
