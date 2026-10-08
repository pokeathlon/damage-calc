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
const {Format} = require('pokemon-showdown/sim/dex-formats');
const {id: mod, ruleset} = require('sim-format');
const BattleStatGuesser = require('sim-guesser');

const ROLLS = [85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100];
const SLOTS = ['attacker', 'attackerAlly', 'defender', 'defenderAlly'];
const WEATHERS = {
	sunnyday: 'Sun', raindance: 'Rain', sandstorm: 'Sand', hail: 'Hail', snowscape: 'Snow',
	desolateland: 'Harsh Sunshine', primordialsea: 'Heavy Rain', deltastream: 'Strong Winds',
};
const STATUSES = {brn: 'burn', psn: 'poison', tox: 'poison'};
const SCREENS = {reflect: 'Physical', lightscreen: 'Special', auroraveil: null};
const FORMATS = {
	singles: new Format({name: `${mod} singles`, mod, gameType: 'singles', ruleset, effectType: 'Format'}),
	doubles: new Format({name: `${mod} doubles`, mod, gameType: 'doubles', ruleset, effectType: 'Format'}),
};
const ROLES = {
	'Fast Physical Sweeper': ['Physical'],
	'Bulky Physical Sweeper': ['Physical'],
	'Fast Special Sweeper': ['Special'],
	'Bulky Special Sweeper': ['Special'],
	'Fast Band': ['Physical', 'Choice Band'],
	'Bulky Band': ['Physical', 'Choice Band'],
	'Fast Specs': ['Special', 'Choice Specs'],
	'Bulky Specs': ['Special', 'Choice Specs'],
	'Physical Scarf': ['Physical', 'Choice Scarf'],
	'Special Scarf': ['Special', 'Choice Scarf'],
	'Physical Biased Mixed Scarf': ['Physical', 'Choice Scarf', 'Special'],
	'Special Biased Mixed Scarf': ['Special', 'Choice Scarf', 'Physical'],
	'Fast Bulky Support': [''],
	'Physically Defensive': [''],
	'Specially Defensive': [''],
};

function listText(list) {
	return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
}

function validate(query) {
	const format = FORMATS[query.format];
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
	const battle = new Battle({format: FORMATS[query.format], seed: 'gen5,0000000000000000'});
	const tr = battle.trunc;
	const field = query.field || {};
	battle.random = (m, n) => (n ?? m ?? 1) - 1;
	battle.randomChance = (numerator, denominator) => numerator >= denominator;
	const getCallback = battle.getCallback;
	battle.getCallback = function (target, effect, callbackName) {
		const callback = getCallback.call(this, target, effect, callbackName);
		const ally = typeof callback === 'function' && target.side &&
			target.side.pokemon.find(other => !other.isActive && other.volatiles[effect.id]);
		if (!ally) return callback;
		return function (...args) {
			this.effectState.target = ally;
			return callback.apply(this, args);
		};
	};
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
		[attacker, defender], [battle.p1.pokemon[1], defender], [defender, attacker], [battle.p2.pokemon[1], attacker],
	].map(([target, foe], i) => [target, query[SLOTS[i]], foe]);
	for (const [target, set] of pokemon) {
		if (!target || !set) continue;
		if (set.mega) battle.actions.runMegaEvo(target);
		if (set.types) target.setType(set.types, true);
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
		if (set.toxicCounter) target.statusState.stage = set.toxicCounter - 1;
		for (const id of set.volatiles || []) {
			target.addVolatile(id, foe);
			if (!target.isActive && target.volatiles[id]) target.side.active[0].volatiles[id] = target.volatiles[id];
		}
		if (set.timesAttacked) target.timesAttacked = set.timesAttacked;
		if (set.activeTurns !== undefined) target.activeTurns = set.activeTurns;
		if (set.boosts) Object.assign(target.boosts, set.boosts);
	}
	if (query.metronome && attacker.volatiles['metronome']) {
		Object.assign(attacker.volatiles['metronome'], {lastMove: toID(query.move), numConsecutive: query.metronome - 1});
		attacker.moveLastTurnResult = true;
	}
	if (query.stellarUsed) attacker.stellarBoostedTypes = [...battle.dex.types.names()];
	if (query.defender.switching) defender.switchFlag = true;

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
	let variable = false;
	let moveType = (query.overrides || {}).type || '';
	const powers = [];
	const getDamage = battle.actions.getDamage;
	battle.actions.getDamage = (source, target, activeMove, suppressMessages) => {
		if (crit && typeof activeMove === 'object' && activeMove.willCrit === undefined) activeMove.willCrit = true;
		if (target === defender) boosts = boosts || [{...source.boosts}, {...target.boosts}];
		const record = target === defender && !turns.length && typeof activeMove === 'object';
		const {basePowerCallback, onBasePower} = record ? activeMove : {};
		let power = basePowerCallback ? 0 : record && activeMove.basePower;
		let modifier = 1;
		if (basePowerCallback) {
			variable = true;
			activeMove.basePowerCallback = function (...args) {
				return (power = basePowerCallback.apply(this, args));
			};
		}
		if (onBasePower) {
			activeMove.onBasePower = function (basePower, ...args) {
				const previous = this.event.modifier;
				const value = onBasePower.call(this, basePower, ...args);
				modifier = (typeof value === 'number' ? value / basePower : 1) * this.event.modifier / previous;
				return value;
			};
		}
		const result = getDamage.call(battle.actions, source, target, activeMove, suppressMessages);
		if (basePowerCallback) activeMove.basePowerCallback = basePowerCallback;
		if (onBasePower) activeMove.onBasePower = onBasePower;
		if (record && power) powers.push(battle.clampIntRange(power, 1) * modifier);
		if (target === defender) {
			if (typeof activeMove === 'object') move = move || activeMove;
			if (typeof result === 'number') damage += result;
		}
		return result;
	};
	const turns = [];
	let turnStart = battle.log.length;
	for (const roll of rolls) {
		battle.randomizer = baseDamage => tr(tr(baseDamage * roll) / 100);
		const activeMove = battle.dex.getActiveMove(query.move);
		Object.assign(activeMove, query.overrides);
		activeMove.accuracy = true;
		const onModifyType = activeMove.onModifyType;
		if (onModifyType && !turns.length) {
			activeMove.onModifyType = function (...args) {
				const value = onModifyType.apply(this, args);
				moveType = activeMove.type;
				return value;
			};
		}
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
		turnStart = battle.log.length;
		battle.actions.useMove(activeMove, attacker, {
			target: defender,
			zMove: query.attacker.zmove ? activeMove.name : undefined,
			maxMove: attacker.volatiles['dynamax'] ? activeMove.name : undefined,
		});
		turns.push(damage);
		defender.switchFlag = false;
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
	const dexMove = battle.dex.moves.get(query.move);
	const total = powers.every(value => value === powers[0]) ? powers[0] : powers.reduce((a, b) => a + b);
	const lastTurn = [];
	for (const line of battle.log.slice(turnStart)) {
		if (line.startsWith('|t:|') || line.startsWith('|split|')) continue;
		lastTurn.push(line.replace(/\|(\d+\/\d+|0)( [a-z]+)?(?=\||$)/g, '|'));
		if (line.includes('|0 fnt')) break;
	}
	const key = JSON.stringify([
		battle.getAllActive().map(target => [
			target.species.id, target.hp, target.status, target.statusState, target.item, target.itemState,
			target.ability, target.abilityState, target.boosts, target.volatiles,
		]),
		battle.field.weather, battle.field.terrain, Object.keys(battle.field.pseudoWeather),
		battle.sides.map(side => side.sideConditions),
	], (k, value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
		const copy = {};
		for (const name of Object.keys(value)) {
			if (!['target', 'source', 'sourceEffect', 'effectOrder'].includes(name)) copy[name] = value[name];
		}
		return copy;
	});
	return {
		battle, attacker, defender, names, species, fieldState, attackerChange, turns, effects, lastTurn, key, boosts,
		power: powers.length && (variable || total !== dexMove.basePower) ? Math.round(total * 10) / 10 : 0,
		moveType: moveType !== dexMove.type ? moveType : '',
		move: move || battle.dex.getActiveMove(query.move),
		ko: defender.hp ? 0 : turns.length,
	};
}

async function koText(query, crit, first, update) {
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
		} else {
			update(`possible ${max.ko}HKO`);
		}
		let deadline = performance.now() + 10;
		const branch = async (state, i) => {
			const result = simulate(query, [...state.rolls, ROLLS[i]], crit);
			if (performance.now() > deadline) {
				await pause();
				deadline = performance.now() + 10;
			}
			return result;
		};
		while (!kos && n < 4) {
			n++;
			total *= ROLLS.length;
			const branches = [];
			for (const state of states.values()) {
				const results = [];
				for (const i of [0, ROLLS.length - 1]) {
					results[i] = await branch(state, i);
					if (running.stale) return '';
				}
				branches.push([state, results]);
			}
			const final = branches.some(([, results]) => results[ROLLS.length - 1].ko);
			const next = new Map();
			for (const [state, results] of branches) {
				let low = 0;
				let high = ROLLS.length - 1;
				while (final && results[high].ko && !results[low].ko && high - low > 1) {
					const mid = Math.floor((low + high) / 2);
					results[mid] = await branch(state, mid);
					if (running.stale) return '';
					if (results[mid].ko) {
						high = mid;
					} else {
						low = mid;
					}
				}
				const probed = [...ROLLS.keys()].filter(i => results[i]);
				const threshold = probed.find(i => results[i].ko) ?? ROLLS.length;
				const longest = probed.map(i => results[i].lastTurn).reduce((a, b) => (b.length > a.length ? b : a));
				const monotonic = final && probed.every(i => !results[i].ko === i < threshold &&
					results[i].lastTurn.every((line, j) => line === longest[j]));
				for (const [i, roll] of ROLLS.entries()) {
					if (!monotonic && !results[i]) {
						results[i] = await branch(state, i);
						if (running.stale) return '';
					}
					const result = results[i];
					if (monotonic ? i >= threshold : result.ko) {
						kos += state.weight;
						for (const effect of result ? result.effects : []) effects.add(effect);
					} else if (!final && result.attacker.hp) {
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
	if (!text && !max.attacker.hp) return 'attacker faints before it can KO';
	return text && effects.size ? `${text} after ${listText([...effects])}` : text;
}

function statText(pokemon, stat) {
	const nature = pokemon.battle.dex.natures.get(pokemon.set.nature);
	const sign = nature.plus === stat ? '+' : nature.minus === stat ? '-' : '';
	const ivs = pokemon.set.ivs[stat] === 31 ? '' : ` ${pokemon.set.ivs[stat]} IVs`;
	return `${pokemon.set.evs[stat]}${sign} ${pokemon.battle.dex.stats.shortNames[stat]}${ivs}`;
}

async function calculate(query, full, firstTurns, update) {
	const crit = !!query.crit;
	const id = JSON.stringify(query);
	const first = (firstTurns && firstTurns.get(id)) || ROLLS.map(roll => simulate(query, [roll], crit));
	if (firstTurns) firstTurns.set(id, first);
	const {battle, attacker, defender, names, species, fieldState, move, boosts, power, moveType} = first[first.length - 1];
	const damage = first.map(result => result.turns[0] || 0);
	const times = query.times > 1 ? ROLLS.map(roll => simulate(query, Array(query.times).fill(roll), crit)) : [];
	const result = {
		damage: times.length ? times.map(({turns, ko}) =>
			turns.reduce((a, b) => a + b) + (ko ? query.times - ko : 0) * turns[turns.length - 1]) : damage,
		maxhp: defender.maxhp, species, field: fieldState, attackerMaxHP: attacker.maxhp,
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
	for (const id of query.defender.volatiles || []) {
		const volatiles = query.defender.volatiles.filter(other => other !== id);
		candidates.push(['defender', dex.conditions.get(id).name, {...query, defender: {...query.defender, volatiles}}]);
	}
	if (query.attacker.alliesFainted) {
		const count = query.attacker.alliesFainted;
		candidates.push([
			'attacker', `${count} ${count === 1 ? 'ally' : 'allies'} fainted`,
			{...query, attacker: {...query.attacker, alliesFainted: 0}},
		]);
	}
	for (const slot of ['attackerAlly', 'defenderAlly']) {
		if (!query[slot]) continue;
		if (toID(query[slot].ability) !== 'noability') {
			candidates.push([slot, dex.abilities.get(query[slot].ability).name, {...query, [slot]: {...query[slot], ability: 'No Ability'}}]);
		}
		for (const id of query[slot].volatiles || []) {
			const volatiles = query[slot].volatiles.filter(other => other !== id);
			candidates.push([slot, dex.conditions.get(id).name, {...query, [slot]: {...query[slot], volatiles}}]);
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
	const relevant = {attacker: [], defender: [], field: [], attackerAlly: [], defenderAlly: []};
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
		...relevant.attackerAlly.map(name => `with an ally's ${name}`),
		move.name,
		(power || moveType) && `(${[power && `${power} BP`, moveType].filter(Boolean).join(' ')})`,
		dex.moves.get(query.move).multihit && move.hit > 1 && `(${move.hit} hits)`,
		query.times > 1 && `over ${query.times} turns`,
		'vs.',
		level(defender),
		showStats && boost(boosts && boosts[1][defensiveStat]),
		showStats && `${statText(defender, 'hp')} / ${statText(defender, defensiveStat)}`,
		...relevant.defender,
		defender.volatiles['dynamax'] && (query.defender.gigantamax ? 'Gigantamax' : 'Dynamax'),
		defender.terastallized && `Tera ${defender.terastallized}`,
		names[1],
		...relevant.defenderAlly.map(name => `with an ally's ${name}`),
		relevant.field.length && `in ${listText(relevant.field)}`,
		screens.length && `through ${listText(screens)}`,
		crit && 'on a critical hit',
	].filter(Boolean).join(' ');
	result.ko = category !== 'Status' && damage[damage.length - 1] ?
		await koText(query, crit, first, ko => update({...result, ko, pending: true})) : '';
	return result;
}

async function run(calc, format, full, firstTurns, update) {
	if (!calc) return null;
	try {
		const query = {...calc, format};
		const error = validate(query);
		return error ? {error} : await calculate(query, full, firstTurns, update);
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

function getPresets(request, format) {
	const query = {format, attacker: {...request.set}, defender: {species: request.set.species}};
	if (validate(query)) return null;
	const {baseStats, types} = simulate(query, [], false).species[0];
	const dex = Dex.forFormat(FORMATS[format]);
	const typeNames = dex.types.all().filter(type => type.exists && !type.isNonstandard).map(type => type.name);
	const coverage = list => typeNames.reduce((total, type) => total + Math.max(...list.map(move => (
		dex.getImmunity(move.type, type) ? 2 ** dex.getEffectiveness(move.type, type) : 0
	))), 0);
	const pool = [];
	for (const [usable, names] of [[true, request.usable], [false, request.other]]) {
		for (const name of names) {
			const move = dex.moves.get(name);
			if (pool.some(entry => entry.move === move)) continue;
			pool.push({
				move, usable,
				score: move.basePower * (move.accuracy === true ? 1 : move.accuracy / 100) *
					(Array.isArray(move.multihit) ? (move.multihit[0] + move.multihit[1]) / 2 : move.multihit || 1) *
					(move.recoil || move.mindBlownRecoil || move.hasCrashDamage ? 0.85 : 1) * (move.priority < 0 ? 0.5 : 1) *
					(move.onTry || move.onTryMove || move.onTryImmunity || move.beforeMoveCallback || move.onDisableMove ? 0.5 : 1),
			});
		}
	}
	pool.sort((a, b) => b.score - a.score);
	const movesets = {};
	const pick = (primary, secondary) => {
		const key = primary + (secondary || '');
		if (movesets[key]) return movesets[key];
		const chosen = [];
		for (const type of types) {
			const stab = pool.find(entry => entry.usable && entry.move.category === primary && entry.move.type === type);
			if (stab) chosen.push(stab.move);
		}
		for (const [category, count] of [[primary, secondary ? 3 : 4], [secondary, 4]]) {
			while (chosen.length < count) {
				let best = null;
				for (const entry of pool) {
					if (!entry.usable || entry.move.category !== category || chosen.some(move => move.type === entry.move.type)) continue;
					const value = coverage([...chosen, entry.move]);
					if (!best || value > best.value) best = {move: entry.move, value};
				}
				if (!best) break;
				chosen.push(best.move);
			}
		}
		for (const entry of [...pool.filter(entry => entry.usable && entry.move.category === primary), ...pool.filter(entry => entry.usable), ...pool]) {
			if (chosen.length < 4 && !chosen.includes(entry.move)) chosen.push(entry.move);
		}
		return (movesets[key] = chosen.map(move => move.name));
	};
	const guesser = new BattleStatGuesser('');
	guesser.dex = dex;
	guesser.getStats = () => baseStats;
	const stronger = baseStats.atk >= baseStats.spa ? 'Physical' : 'Special';
	const required = dex.species.get(request.set.species).requiredItem;
	const presets = {role: guesser.guessRole({...request.set, item: '', moves: pick(stronger)}), sets: {}};
	for (const [role, [category, item, secondary]] of Object.entries(ROLES)) {
		if (item && required) continue;
		const set = {...request.set, item: item || required || '', moves: pick(category || stronger, secondary)};
		if (guesser.guessRole(set) === '?') continue;
		const guess = guesser.guessEVs(set, role);
		const nature = dex.natures.all().find(entry => entry.plus === guess.plusStat && entry.minus === guess.minusStat);
		const evs = {};
		for (const stat of dex.stats.ids()) {
			if (guess[stat]) evs[stat] = guess[stat];
		}
		const label = Object.keys(evs).map(stat => `${evs[stat]} ${dex.stats.shortNames[stat]}`).join(' / ') +
			(nature ? ` (+${dex.stats.shortNames[nature.plus]}, -${dex.stats.shortNames[nature.minus]})` : '');
		presets.sets[role] = {evs, nature: nature ? nature.name : 'Hardy', item: set.item, moves: set.moves, label};
	}
	return presets;
}

const queue = {main: null, box: null};
const firstTurns = new Map();
const channel = new MessageChannel();
let running = null;

function pause() {
	return new Promise(resolve => {
		channel.port1.onmessage = resolve;
		channel.port2.postMessage(null);
	});
}

async function work() {
	while (queue.main || queue.box) {
		const request = queue.main || queue.box;
		const kind = request === queue.main ? 'main' : 'box';
		queue[kind] = null;
		const job = running = {kind, stale: false};
		if (kind === 'main' && !request.full) firstTurns.clear();
		const speeds = request.speed && getSpeeds(request.speed, request.format);
		if (speeds) postMessage({id: request.id, speeds});
		for (const [index, calc] of request.calcs) {
			const result = await run(calc, request.format, !!request.full, kind === 'main' && firstTurns,
				partial => postMessage({id: request.id, index, result: partial, full: true}));
			if (job.stale) break;
			postMessage({id: request.id, index, result, full: !!request.full});
			await pause();
			if (job.stale) break;
		}
		running = null;
	}
}

globalThis.onmessage = function (event) {
	if (event.data.presets) {
		let presets = null;
		try {
			presets = getPresets(event.data.presets, event.data.format);
		} catch (error) {
			console.error(error);
		}
		postMessage({id: event.data.id, side: event.data.side, presets});
		return;
	}
	const kind = event.data.rangesOnly ? 'box' : 'main';
	queue[kind] = event.data;
	if (running && (running.kind === kind || kind === 'main')) running.stale = true;
	if (!running) work();
};

try {
	const dex = Dex.forFormat(FORMATS.singles);
	const species = dex.species.all().find(entry => entry.exists && !entry.battleOnly).name;
	const move = dex.moves.all().find(entry => entry.exists && entry.basePower && !entry.isZ && !entry.isMax).name;
	const query = {format: 'singles', attacker: {species}, defender: {species}, move};
	if (!validate(query)) {
		for (const roll of ROLLS) simulate(query, [roll], false);
	}
} catch {}
