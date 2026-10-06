'use strict';

const modules = require('sim-modules');
const {resolve} = require('path');

globalThis.require = function (id) {
	const key = resolve(id);
	if (modules[key]) return modules[key]();
	const error = new Error(`Cannot find module '${id}'`);
	error.code = 'MODULE_NOT_FOUND';
	throw error;
};
globalThis.require.resolve = function (id) {
	return globalThis.require(id) && id;
};

const {Battle} = require('pokemon-showdown/sim/battle');
const {Dex, toID} = require('pokemon-showdown/sim/dex');

const ROLLS = [85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100];
const SLOTS = ['attacker', 'attackerAlly', 'defender', 'defenderAlly'];
const WEATHERS = {
	sunnyday: 'Sun', raindance: 'Rain', sandstorm: 'Sand', hail: 'Hail', snowscape: 'Snow',
	desolateland: 'Harsh Sunshine', primordialsea: 'Heavy Rain', deltastream: 'Strong Winds',
};
const STATUSES = {brn: 'burn', psn: 'poison', tox: 'poison'};
const SCREENS = {reflect: 'Physical', lightscreen: 'Special', auroraveil: null};

function listText(list) {
	return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
}

function validate(query) {
	const format = Dex.formats.get(query.format);
	const dex = Dex.forFormat(format);
	if (!query.attacker || !query.defender) return `An attacker and a defender are required.`;
	if (query.move && !dex.moves.get(query.move).exists) return `Unknown move '${query.move}'.`;
	if (format.gameType === 'doubles') {
		query.attackerAlly = query.attackerAlly || {species: query.attacker.species, ability: 'No Ability'};
		query.defenderAlly = query.defenderAlly || {species: query.defender.species, ability: 'No Ability'};
	}
	for (const slot of SLOTS) {
		const set = query[slot];
		if (!set) continue;
		const species = dex.species.get(set.species);
		if (!species.exists) return `Unknown Pokémon '${set.species}'.`;
		if (set.fusion && !dex.species.get(set.fusion).exists) return `Unknown Pokémon '${set.fusion}'.`;
		if (set.item && !dex.items.get(set.item).exists) return `Unknown item '${set.item}'.`;
		for (const ability of [set.ability, set.ability2]) {
			if (ability && !dex.abilities.get(ability).exists) return `Unknown ability '${ability}'.`;
		}
		if (typeof set.tera === 'string' && !dex.types.get(set.tera).exists) return `Unknown type '${set.tera}'.`;
		if (set.status && dex.conditions.get(set.status).effectType !== 'Status') return `Unknown status '${set.status}'.`;
		for (const id of set.volatiles || []) {
			if (!dex.conditions.get(id).exists) return `Unknown volatile '${id}'.`;
		}
		set.ability = set.ability || species.abilities[0];
	}
	const field = query.field || {};
	if (field.weather) {
		field.weather = Object.keys(WEATHERS).find(id => toID(WEATHERS[id]) === toID(field.weather)) || field.weather;
		if (!dex.conditions.get(field.weather).exists) return `Unknown weather '${field.weather}'.`;
	}
	if (field.terrain) {
		if (!toID(field.terrain).endsWith('terrain')) field.terrain += ' Terrain';
		if (!dex.conditions.get(field.terrain).exists) return `Unknown terrain '${field.terrain}'.`;
	}
	for (const id of [...field.pseudoWeather || [], ...field.attackerSide || [], ...field.defenderSide || []]) {
		if (!dex.conditions.get(id).exists) return `Unknown field condition '${id}'.`;
	}
	return '';
}

function simulate(query, rolls, crit) {
	const battle = new Battle({formatid: query.format, seed: 'gen5,0000000000000000'});
	const tr = battle.trunc;
	const field = query.field || {};
	battle.random = (m, n) => (n ?? m ?? 1) - 1;
	battle.randomChance = (numerator, denominator) => numerator >= denominator;
	const turnLoop = battle.turnLoop;
	battle.turnLoop = () => {};
	battle.setPlayer('p1', {team: [query.attacker, query.attackerAlly].filter(Boolean).map(set => ({moves: [query.move], ...set}))});
	battle.setPlayer('p2', {team: [query.defender, query.defenderAlly].filter(Boolean).map(set => ({moves: [query.move], ...set}))});
	battle.turnLoop = turnLoop;
	battle.p1.totalFainted = query.attacker.alliesFainted || 0;
	battle.p2.totalFainted = query.defender.alliesFainted || 0;
	if (battle.requestState === 'teampreview') {
		battle.makeChoices('default', 'default');
	} else {
		battle.turnLoop();
	}
	for (const [side, conditions] of [[battle.p1, field.attackerSide], [battle.p2, field.defenderSide]]) {
		for (const id of conditions || []) side.addSideCondition(id, side.active[0]);
		for (const [id, state] of Object.entries(side.sideConditions)) {
			delete state.duration;
			for (const target of side.active) {
				if (target) battle.singleEvent('SwitchIn', battle.dex.conditions.get(id), state, target);
			}
		}
	}

	const setupLength = battle.log.length;
	const attacker = battle.p1.active[0];
	const defender = battle.p2.active[0];
	const pokemon = [
		[attacker, defender], [battle.p1.active[1], defender], [defender, attacker], [battle.p2.active[1], attacker],
	].map(([target, foe], i) => [target, query[SLOTS[i]], foe]);
	for (const [target, set] of pokemon) {
		if (!target || !set) continue;
		if (set.mega) battle.actions.runMegaEvo(target);
		if (set.tera) {
			if (typeof set.tera === 'string') target.teraType = battle.dex.types.get(set.tera).name;
			battle.actions.terastallize(target);
		}
		if (set.hp !== undefined) target.sethp(typeof set.hp === 'string' ? target.maxhp * parseFloat(set.hp) / 100 : set.hp);
		if (set.dynamax) target.addVolatile('dynamax');
	}
	if (field.weather !== undefined) {
		if (field.weather) {
			battle.field.setWeather(field.weather, attacker);
		} else {
			battle.field.clearWeather();
		}
		delete battle.field.weatherState.duration;
	}
	if (field.terrain !== undefined) {
		if (field.terrain) {
			battle.field.setTerrain(field.terrain, attacker);
		} else {
			battle.field.clearTerrain();
		}
		delete battle.field.terrainState.duration;
	}
	for (const id of field.pseudoWeather || []) {
		battle.field.addPseudoWeather(id, attacker);
		const state = battle.field.pseudoWeather[battle.dex.conditions.get(id).id];
		if (state) delete state.duration;
	}
	for (const [target, set, foe] of pokemon) {
		if (!target || !set) continue;
		if (set.status) target.setStatus(set.status, foe, null, true);
		for (const id of set.volatiles || []) target.addVolatile(id, foe);
		if (set.timesAttacked) target.timesAttacked = set.timesAttacked;
		if (set.boosts) Object.assign(target.boosts, set.boosts);
	}

	const names = [attacker, defender].map(target => target.species.name +
		(target.m.fusion ? `/${battle.dex.species.get(target.m.fusion).name}` : ''));
	const species = [attacker, defender].map(target => ({
		baseStats: target.species.baseStats, types: target.species.types, stats: {hp: target.maxhp, ...target.storedStats},
		speed: target.getStat('spe'),
	}));
	const fieldState = {
		weather: battle.field.weather && (WEATHERS[battle.field.weather] || battle.field.getWeather().name),
		terrain: battle.field.terrain && battle.field.getTerrain().name.replace(/ Terrain$/, ''),
	};
	const attackerHP = attacker.hp;
	let attackerChange = 0;
	let damage = 0;
	let move;
	let boosts;
	const getDamage = battle.actions.getDamage;
	battle.actions.getDamage = (source, target, activeMove, suppressMessages) => {
		if (crit && typeof activeMove === 'object' && activeMove.willCrit === undefined) activeMove.willCrit = true;
		if (target === defender) boosts = boosts || [{...source.boosts}, {...target.boosts}];
		const result = getDamage.call(battle.actions, source, target, activeMove, suppressMessages);
		if (target === defender) {
			if (typeof activeMove === 'object') move = move || activeMove;
			if (typeof result === 'number') damage += result;
		}
		return result;
	};
	const turns = [];
	for (const roll of rolls) {
		battle.randomizer = baseDamage => tr(tr(baseDamage * roll) / 100);
		const activeMove = battle.dex.getActiveMove(query.move);
		activeMove.accuracy = true;
		if (activeMove.category !== 'Status') {
			delete activeMove.onTry;
			if (activeMove.flags['charge']) delete activeMove.onTryMove;
		}
		if (query.hits && activeMove.multihit) {
			activeMove.multihit = query.hits;
		} else if (Array.isArray(activeMove.multihit)) {
			activeMove.multihit = attacker.hasAbility('skilllink') ? activeMove.multihit[1] :
				attacker.hasItem('loadeddice') ? 4 : activeMove.multihit[0] + 1;
		}
		damage = 0;
		battle.actions.useMove(activeMove, attacker, {
			target: defender,
			zMove: query.attacker.zmove ? activeMove.name : undefined,
			maxMove: attacker.volatiles['dynamax'] ? activeMove.name : undefined,
		});
		turns.push(damage);
		if (turns.length === 1) attackerChange = attacker.hp - attackerHP;
		if (!defender.hp || !attacker.hp || battle.ended) break;
		battle.turnLoop();
		if (!defender.hp || !attacker.hp || battle.ended) break;
	}

	const effects = [];
	for (const [i, line] of battle.log.entries()) {
		const parts = line.split('|');
		if (!parts[2] || !parts[2].startsWith('p2a:')) continue;
		if (['-damage', '-heal'].includes(parts[1]) && parts[4] && parts[4].startsWith('[from] ') &&
			!parts[4].includes('pokemon:') && (i >= setupLength || query.defender.hp === undefined)) {
			const from = parts[4].slice(7).replace(/^(item|ability): /, '');
			effects.push(`${STATUSES[from] || from} ${parts[1] === '-heal' ? 'recovery' : 'damage'}`);
		} else if (i >= setupLength && ((parts[1] === '-enditem' && !parts[4]) ||
			(parts[1] === '-activate' && /^(item|ability): /.test(parts[3])))) {
			effects.push(parts[3].replace(/^(item|ability): /, ''));
		}
	}
	const key = JSON.stringify([
		battle.getAllActive().map(target => [
			target.species.id, target.hp, target.status, target.statusState, target.item, target.itemState,
			target.ability, target.abilityState, target.boosts, target.volatiles,
		]),
		battle.field.weather, battle.field.terrain, Object.keys(battle.field.pseudoWeather),
		battle.sides.map(side => side.sideConditions),
	], (k, value) => (['target', 'source', 'sourceEffect', 'effectOrder'].includes(k) ? undefined : value));
	return {
		battle, attacker, defender, names, species, fieldState, attackerChange, turns, effects, key, boosts,
		move: move || battle.dex.getActiveMove(query.move),
		ko: defender.hp ? 0 : turns.length,
	};
}

function koText(query, crit, first) {
	const effects = new Set();
	let total = ROLLS.length;
	let kos = 0;
	let states = new Map();
	for (const [i, result] of first.entries()) {
		if (result.ko) {
			kos++;
			for (const effect of result.effects) effects.add(effect);
		} else if (result.attacker.hp) {
			const state = states.get(result.key);
			if (state) {
				state.weight++;
			} else {
				states.set(result.key, {rolls: [ROLLS[i]], weight: 1});
			}
		}
	}
	let n = 1;
	const min = simulate(query, Array(9).fill(ROLLS[0]), crit);
	const max = simulate(query, Array(9).fill(ROLLS[ROLLS.length - 1]), crit);
	if (!kos && max.ko && max.ko <= 4) {
		if (min.ko === max.ko) {
			n = max.ko;
			kos = total;
			for (const effect of [...min.effects, ...max.effects]) effects.add(effect);
		}
		while (!kos && n < 4) {
			n++;
			total *= ROLLS.length;
			const next = new Map();
			for (const state of states.values()) {
				for (const roll of ROLLS) {
					const result = simulate(query, [...state.rolls, roll], crit);
					if (result.ko) {
						kos += state.weight;
						for (const effect of result.effects) effects.add(effect);
					} else if (result.attacker.hp) {
						const nextState = next.get(result.key);
						if (nextState) {
							nextState.weight += state.weight;
						} else {
							next.set(result.key, {rolls: [...state.rolls, roll], weight: state.weight});
						}
					}
				}
			}
			states = next;
		}
	}
	let text = '';
	if (kos) {
		const hko = n === 1 ? 'OHKO' : `${n}HKO`;
		text = kos === total ? `guaranteed ${hko}` : `${Math.round(kos * 1000 / total) / 10 || '<0.1'}% chance to ${hko}`;
	}
	for (n = 5; n <= 9 && !text; n++) {
		const result = min.ko && min.ko <= n ? min : max.ko && max.ko <= n ? max : null;
		if (!result) continue;
		text = `${result === min ? 'guaranteed' : 'possible'} ${n}HKO`;
		for (const effect of result.effects) effects.add(effect);
	}
	return text && effects.size ? `${text} after ${listText([...effects])}` : text;
}

function statText(pokemon, stat) {
	const nature = pokemon.battle.dex.natures.get(pokemon.set.nature);
	const sign = nature.plus === stat ? '+' : nature.minus === stat ? '-' : '';
	const ivs = pokemon.set.ivs[stat] === 31 ? '' : ` ${pokemon.set.ivs[stat]} IVs`;
	return `${pokemon.set.evs[stat]}${sign} ${pokemon.battle.dex.stats.shortNames[stat]}${ivs}`;
}

function calculate(query, full) {
	const crit = !!query.crit;
	const first = ROLLS.map(roll => simulate(query, [roll], crit));
	const {battle, attacker, defender, names, species, fieldState, move, boosts} = first[first.length - 1];
	const damage = first.map(result => result.turns[0] || 0);
	const result = {
		damage, maxhp: defender.maxhp, species, field: fieldState, attackerMaxHP: attacker.maxhp,
		attackerChange: [first[0].attackerChange, first[first.length - 1].attackerChange],
	};
	if (!full) return result;

	const dex = battle.dex;
	const field = query.field || {};
	const candidates = [];
	for (const slot of ['attacker', 'defender']) {
		for (const key of ['item', 'ability', 'ability2']) {
			if (!query[slot][key]) continue;
			const name = key === 'item' ? dex.items.get(query[slot][key]).name : dex.abilities.get(query[slot][key]).name;
			candidates.push([slot, name, {...query, [slot]: {...query[slot], [key]: key === 'item' ? '' : 'No Ability'}}]);
		}
	}
	if (battle.field.weather) {
		const name = WEATHERS[battle.field.weather] || battle.field.getWeather().name.replace(/([a-z])([A-Z])/g, '$1 $2');
		candidates.push(['field', name, {...query, field: {...field, weather: ''}}]);
	}
	if (battle.field.terrain) {
		candidates.push(['field', battle.field.getTerrain().name, {...query, field: {...field, terrain: ''}}]);
	}
	for (const id of field.pseudoWeather || []) {
		const pseudoWeather = field.pseudoWeather.filter(other => other !== id);
		candidates.push(['field', dex.conditions.get(id).name, {...query, field: {...field, pseudoWeather}}]);
	}
	const relevant = {attacker: [], defender: [], field: []};
	for (const [slot, name, modified] of candidates) {
		if (simulate(modified, [ROLLS[ROLLS.length - 1]], crit).turns[0] === damage[damage.length - 1]) continue;
		relevant[slot].push(name);
	}

	const category = battle.getCategory(move);
	const offensiveStat = move.overrideOffensiveStat || (category === 'Physical' ? 'atk' : 'spa');
	const defensiveStat = move.overrideDefensiveStat || (category === 'Physical' ? 'def' : 'spd');
	const showStats = category !== 'Status' && !move.damage && !move.damageCallback && !move.ohko;
	const level = target => (attacker.level !== defender.level ? `Lvl ${target.level}` : '');
	const boost = (value = 0) => (value > 0 ? `+${value}` : value < 0 ? `${value}` : '');
	const screens = crit ? [] : Object.keys(defender.side.sideConditions)
		.filter(id => id in SCREENS && (!SCREENS[id] || SCREENS[id] === category))
		.map(id => dex.conditions.get(id).name);
	result.description = [
		level(attacker),
		showStats && boost(boosts && boosts[0][offensiveStat]),
		showStats && statText(attacker, offensiveStat),
		...relevant.attacker,
		showStats && category === 'Physical' && attacker.status === 'brn' && 'burned',
		attacker.terastallized && `Tera ${attacker.terastallized}`,
		names[0],
		...(query.attacker.volatiles || []).map(id => dex.conditions.get(id).name),
		move.name,
		dex.moves.get(query.move).multihit && move.hit > 1 && `(${move.hit} hits)`,
		'vs.',
		level(defender),
		showStats && boost(boosts && boosts[1][defensiveStat]),
		showStats && `${statText(defender, 'hp')} / ${statText(defender, defensiveStat)}`,
		...relevant.defender,
		defender.terastallized && `Tera ${defender.terastallized}`,
		names[1],
		relevant.field.length && `in ${listText(relevant.field)}`,
		screens.length && `through ${listText(screens)}`,
		crit && 'on a critical hit',
	].filter(Boolean).join(' ');
	result.ko = category !== 'Status' && damage[damage.length - 1] ? koText(query, crit, first) : '';
	return result;
}

function run(calc, format, full) {
	if (!calc) return null;
	try {
		const query = {...calc, format};
		const error = validate(query);
		return error ? {error} : calculate(query, full);
	} catch (error) {
		console.error(error);
		return {error: `The simulator crashed on this calculation: ${error.message}`};
	}
}

function getSpeeds(calc, format) {
	try {
		const query = {...calc, format};
		return validate(query) ? null : simulate(query, [], false).species.map(target => target.speed);
	} catch {
		return null;
	}
}

const queue = {main: null, box: null};
let running = null;

async function work() {
	while (queue.main || queue.box) {
		const request = queue.main || queue.box;
		const kind = request === queue.main ? 'main' : 'box';
		queue[kind] = null;
		const job = running = {kind, stale: false};
		const speeds = request.speed && getSpeeds(request.speed, request.format);
		if (speeds) postMessage({id: request.id, speeds});
		for (const full of request.rangesOnly ? [false] : [false, true]) {
			const results = [];
			for (const calc of request.calcs) {
				results.push(run(calc, request.format, full));
				await new Promise(resolveTick => setTimeout(resolveTick));
				if (job.stale) break;
			}
			if (job.stale) break;
			postMessage({id: request.id, results, full: full || !!request.rangesOnly});
		}
		running = null;
	}
}

globalThis.onmessage = function (event) {
	const kind = event.data.rangesOnly ? 'box' : 'main';
	queue[kind] = event.data;
	if (running && (running.kind === kind || kind === 'main')) running.stale = true;
	if (!running) work();
};
