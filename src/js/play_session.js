import {el, mount, unmount, setStyle, setAttr} from "redom";
import {setFeatsContext, feats, event} from "./feat.js";
import {
    setTableContext,
    pushComponentUpdate,
    pushNewComponent,
    pushNewKit,
    pushSyncWithMe,
    pushRemoveComponent,
    joinTable,
    pushCursorMovement,
    consolidatePropagation,
} from "./sync_table.js";
import {toolbox} from "./toolbox.js"
import {Menu} from "./menu.js";
import {_, language} from "./i18n.js"
import {dev_inspector} from "./dev_inspector.js"
import interact from 'interactjs';
import '../style/game.css';

function baseUrl() {
    return location.protocol + "//" + location.hostname + (location.port ? ":" + location.port : "") + "/";
}

class Component {
    constructor(data) {
        this.el = el(".component");
        for (const ability of feats) {
            ability.install(this, data);
        }
    }

    update(data, componentId) {
        this.receiveData(data, componentId);
        this.updateView(data);
    }

    receiveData(data, componentId) {
        this.componentId = componentId;
        for (const ability of feats) {
            if (ability.isEnabled(this, data)) {
                if(ability.hasOwnProperty('receiveData')) {
                    ability.receiveData(this, data);
                }
            }
        }
    }

    updateView(data) {
        for (const ability of feats) {
            if (ability.isEnabled(this, data)) {
                if(ability.hasOwnProperty('updateView')) {
                    ability.updateView(this, data);
                } else {
                    ability.onComponentUpdate(this, data);
                }
            }
        }
    }

    disappear() {
        for (const ability of feats) {
            ability.uninstall(this);
        }
    }

    propagate(diff) {
        dev_inspector.tracePoint('propagate');
        pushComponentUpdate(table, this.componentId, diff, false);
    }

    propagate_volatile(diff) {
        pushComponentUpdate(table, this.componentId, diff, true);
    }
}

class Table {
    constructor() {
        console.log("new Table");
        this.el = el("div.table", { style: { left: '0px', top: '0px' } },
            this.list_el = el("div.table_list")
        );
        // this.list = list(this.list_el, Component);
        this.componentsOnTable = {};
        this.data = {};
    }

    receiveData(data) {
        this.data = {
            components: data.components,
            kits: data.kits,
            players: data.players,
        };
        for (const componentId in this.data.components) {
            if (!this.data.components.hasOwnProperty(componentId)) {
                continue;
            }
            const componentData = this.data.components[componentId];
            if (!this.componentsOnTable[componentId]) {
                this.componentsOnTable[componentId] = new Component(componentData);
                mount(this.list_el, this.componentsOnTable[componentId].el);
            }
            this.componentsOnTable[componentId].receiveData(componentData, componentId);
        }

        dev_inspector.tracePoint('finish updating table data');
    }

    updateView() {
        const notUpdatedComponents = Object.assign({}, this.componentsOnTable);
        setFeatsContext(getPlayerName, isPlayerObserver, this);

        for (const componentId in this.data.components) {
            if (!this.data.components.hasOwnProperty(componentId)) {
                continue;
            }
            const componentData = this.data.components[componentId];
            this.componentsOnTable[componentId].updateView(componentData);

            delete notUpdatedComponents[componentId]
        }

        for (const componentIdToRemove in notUpdatedComponents) {
            if (!notUpdatedComponents.hasOwnProperty(componentIdToRemove)) {
                continue;
            }
            delete this.componentsOnTable[componentIdToRemove];
            unmount(this.list_el, notUpdatedComponents[componentIdToRemove].el);
        }
        dev_inspector.tracePoint('finish updating table view');
    }

    update(data) {
        this.receiveData(data);
        this.updateView();
        dev_inspector.tracePoint('finish updating table');
    }

    addComponent(componentData) {
        // This is called when a component is added ON THIS BROWSER.
        this.data.components[componentData.componentId] = componentData;
        this.componentsOnTable[componentData.componentId] = new Component(componentData);
        mount(this.list_el, this.componentsOnTable[componentData.componentId].el);
        this.componentsOnTable[componentData.componentId].update(componentData, componentData.componentId);
        event.fireEvent(this.componentsOnTable[componentData.componentId], event.events.onPositionChanged,
            {
                left: parseFloat(componentData.left),
                top: parseFloat(componentData.top),
                width: parseFloat(componentData.width),
                height: parseFloat(componentData.height),
            });
    }

    removeComponent(componentId) {
        // This is called when a component is removed ON THIS BROWSER.
        // Because component removal is not directly synced but propagated as table refresh,
        // table relies on update() to detect unused / non-referenced components
        // to remove Component object and DOM object.
        // TODO: maybe it's economical to sync component removal directly...
        this.componentsOnTable[componentId].disappear();
    }

    consolidatePropagation(proc) {
        consolidatePropagation(proc);
    }

    findEmptySpace(width, height) {
        const rect = {
            left: 64,
            top: 64,
            width: parseFloat(width),
            height: parseFloat(height),
        };
        for (let i = 0; i < 10; i++) {
            let collision = false;
            rect.bottom = rect.top + rect.height;
            rect.right = rect.left + rect.width;
            for (const componentId in this.data.components) {
                const target = this.data.components[componentId];
                const targetLeft = parseFloat(target.left);
                const targetTop = parseFloat(target.top);
                const targetRight = targetLeft + parseFloat(target.width);
                const targetBottom = targetTop + parseFloat(target.height);
                if (rect.left <= targetRight &&
                    targetLeft <= rect.right &&
                    rect.top <= targetBottom &&
                    targetTop <= rect.bottom) {
                    collision = true;
                    break;
                }
            }
            if (!collision) {
                break;
            }
            rect.top += 100;
        }
        return rect;
    }

    getNextZIndex() {
        let nextZIndex = 0;
        for (const otherId in this.data.components) {
            const other = this.data.components[otherId];
            if (nextZIndex <= other.zIndex) {
                nextZIndex = other.zIndex + 1;
            }
        }
        return nextZIndex;
    }

    getNextZIndexFor(componentData) {
        let currentZIndex = componentData.zIndex;
        for (const otherId in this.data.components) {
            if (otherId === componentData.componentId) {
                continue;
            }
            const other = this.data.components[otherId];
            if (currentZIndex <= other.zIndex) {
                currentZIndex = other.zIndex + 1;
            }
        }
        return currentZIndex;
    }

    getAllHandAreas() {
        const handAreasData = [];
        for (const cmpId in this.data.components) {
            const cmp = this.data.components[cmpId];
            if (cmp.handArea) {
                handAreasData.push(cmp);
            }
        }
        return handAreasData;
    }
}

const sync_table_connector = {
    initializeTable: function (tableData) {
        console.log("initializeTable");
        console.log("tableData: ", tableData);
        const players = tableData.players;
        console.log("players: ", players);
        if (Object.keys(players).length === 0) {
            joinTable("host", true);  // the first player is automatically becomes host
        } else if (getPlayerName() !== "nobody") {
            joinTable(getPlayerName(), isPlayerHost());
        } else {
            setPlayerIsObserver();
        }

        table.update(tableData);
        menu.update(tableData);
    },

    updateSingleComponent: function (componentId, diff) {
        const tableData = table.data;
        if (tableData.components[componentId].lastUpdated) {
            if (tableData.components[componentId].lastUpdated.from === diff.lastUpdated.from
                && tableData.components[componentId].lastUpdated.epoch > diff.lastUpdated.epoch) {
                dev_inspector.tracePoint('aborted sync update single component');
                // already recieved newer update for this component; ignore the diff
                return;
            }
        }
        Object.assign(tableData.components[componentId], diff);
        table.update(tableData);
        menu.update(tableData);
        dev_inspector.tracePoint('finished sync update single component');
    },

    updateManyComponents: function (updates) {
        const tableData = table.data;
        for (const event of updates) {
            if (event.eventName !== 'update single component') {
                console.error('updateManyComponents cannot handle events other than update single component', event);
                continue;
            }
            const componentId = event.data.componentId;
            const diff = event.data.diff;
            if (tableData.components[componentId].lastUpdated) {
                if (tableData.components[componentId].lastUpdated.from === diff.lastUpdated.from
                    && tableData.components[componentId].lastUpdated.epoch > diff.lastUpdated.epoch) {
                    // already recieved newer update for this component; ignore the diff
                    continue;
                }
            }
            Object.assign(tableData.components[componentId], diff);
        }
        table.update(tableData);
        menu.update(tableData);
        dev_inspector.tracePoint('finished sync update many components');
    },

    addComponent: function (componentData) {
        if (!table.data.components[componentData.componentId]) {
            table.data.components[componentData.componentId] = componentData;
        }
        if (!table.componentsOnTable[componentData.componentId]) {
            table.componentsOnTable[componentData.componentId] = new Component(componentData);
            mount(table.list_el, table.componentsOnTable[componentData.componentId].el);
            table.componentsOnTable[componentData.componentId].update(componentData, componentData.componentId);
        }
        table.update(table.data);
        menu.update(table.data);
    },

    addKit: function (kitData) {
        for (const existKit of table.data.kits) {
            if (existKit.kitId === kitData.kitId) {
                return;
            }
        }
        table.data.kits.push(kitData);
        menu.update(table.data);
    },

    update_whole_table: function (data) {
        table.update(data);
        menu.update(data);
    },

    updatePlayer: function (playerData) {
        if (playerData.name) {
            setPlayerIsJoined();
            setPlayerName(playerData.name);
        }
    },

    showOthersMouseMovement: function (playerName, mouseMovement) {
        const ICON_OFFSET_X = -(32 / 2);  // see "div.others_mouse_cursor .icon " in game.css
        const ICON_OFFSET_Y = -(32 / 2);
        if (playerName === getPlayerName()) {
            return;
        }
        if (!otherPlayersMouse[playerName]) {
            const e = el("div.others_mouse_cursor",
                [
                    el("div.icon"),
                    el("span", playerName),
                ]);
            mount(table.el, e);
            otherPlayersMouse[playerName] = e;
        }
        const e = otherPlayersMouse[playerName];
        const left = mouseMovement.mouseOnTableX + ICON_OFFSET_X;
        const top = mouseMovement.mouseOnTableY + ICON_OFFSET_Y;
        const className = mouseMovement.mouseButtons === 0 ? "" : "buttons_down";
        setAttr(e, { className: "others_mouse_cursor " + className });
        setStyle(e, { left: left + "px", top: top + "px", zIndex: 999999999 });
    },
};

const otherPlayersMouse = {};

function generateComponentId() {
    return 'xxxxxxxxxxxx'.replace(/[x]/g, function (/*c*/) {
        return (Math.random() * 16 | 0).toString(16);
    });
}

function addNewKit(kitData) {
    const kitName = kitData.kit.name;
    const kitId = 'xxxxxxxxxxxx'.replace(/[x]/g, function (/*c*/) {
        return (Math.random() * 16 | 0).toString(16);
    });

    const baseZIndex = table.getNextZIndex();
    (async () => {
        const newComponents = {};
        const usedComponentsData = await (await fetch(encodeURI(baseUrl() + "components?kit_name=" + kitName))).json();
        const layouter = kitLayouter(kitData.kit.positionOfKitContents);
        const componentDataMap = {};
        for (const cmp of usedComponentsData) {
            componentDataMap[cmp['component']['name']] = cmp;
        }

        consolidatePropagation(() => {
            layouter();

            for (const componentId in newComponents) {
                const newComponentData = newComponents[componentId];
                pushNewComponent(newComponentData);
                table.addComponent(newComponentData);
            }
            pushNewKit({
                kit: { name: kitName, kitId: kitId },
            });
        });

        function createComponent(name) {
            const newComponentData = Object.assign({}, componentDataMap[name].component);
            newComponentData.kitId = kitId;
            const componentId = generateComponentId();
            newComponentData.componentId = componentId;
            newComponents[componentId] = newComponentData;

            return newComponentData;
        }

        function createContentsOfBox(boxData, contentNames) {
            boxData.componentsInBox = {};
            for (const name of contentNames) {
                const boxOrComponentData = createComponent(name);
                const componentId = boxOrComponentData.componentId;

                boxData.componentsInBox[componentId] = true;
            }

            switch (boxData.positionOfBoxContents) {
                case "random":
                    for (const contentId in boxData.componentsInBox) {
                        const contentData = newComponents[contentId];
                        layoutRandomly(contentData, boxData);
                    }
                    break;
                default:
                    for (const contentId in boxData.componentsInBox) {
                        const contentData = newComponents[contentId];
                        layoutRelativelyAsDefined(contentData, boxData);
                    }
            }
        }

        function layoutRandomly(newComponentData, baseRect) {
            newComponentData.left = Math.floor(parseFloat(baseRect.left) +
                (Math.random() * (parseFloat(baseRect.width) - parseFloat(newComponentData.width))));
            newComponentData.top = Math.floor(parseFloat(baseRect.top) +
                (Math.random() * (parseFloat(baseRect.height) - parseFloat(newComponentData.height))));
            if (newComponentData.zIndex) {
                newComponentData.zIndex += baseZIndex;
            } else {
                newComponentData.zIndex = baseZIndex;
            }

        }

        function layoutRelativelyAsDefined(newComponentData, baseRect) {
            newComponentData.left = parseFloat(newComponentData.left) + parseFloat(baseRect.left);
            newComponentData.top = parseFloat(newComponentData.top) + parseFloat(baseRect.top);
            if (newComponentData.zIndex) {
                newComponentData.zIndex += baseZIndex;
            } else {
                newComponentData.zIndex = baseZIndex;
            }
            if (newComponentData.onAdd) {
                Function('"use strict"; return ' + newComponentData.onAdd)()(newComponentData);
            }
        }

        function layoutInHandArea(componentsInHandArea, handAreaData) {
            const horizontalStart = parseFloat(handAreaData.left) + 1;
            const width = parseFloat(handAreaData.width) - 2;
            const verticalStart = parseFloat(handAreaData.top) + 1;
            const height = parseFloat(handAreaData.height) - 2;

            const count = componentsInHandArea.length;
            componentsInHandArea.sort((a, b) => b.zIndex - a.zIndex);
            let index = 0;
            for (const cmp of componentsInHandArea) {
                cmp.left = horizontalStart + ((width - parseFloat(cmp.width)) / count) * index;
                cmp.top = verticalStart + ((height - parseFloat(cmp.height)) / count) * index;
                index += 1;
            }

        }

        function kitLayouter(name) {
            switch (name) {
                case "on all hand areas":
                    return function () {
                        const handAreasData = table.getAllHandAreas();
                        if (handAreasData.length > 0) {
                            for (const handAreaData of handAreasData) {
                                const componentsInHandArea = [];
                                for (const name in kitData.kit.boxAndComponents) {
                                    if (!kitData.kit.boxAndComponents.hasOwnProperty(name)) {
                                        continue;
                                    }
                                    const boxOrComponentData = createComponent(name);
                                    if (boxOrComponentData.zIndex) {
                                        boxOrComponentData.zIndex += baseZIndex;
                                    } else {
                                        boxOrComponentData.zIndex = baseZIndex;
                                    }
                                    componentsInHandArea.push(boxOrComponentData);
                                }
                                layoutInHandArea(componentsInHandArea, handAreaData);

                                const contents = kitData.kit.boxAndComponents[name];
                                if (contents) {
                                    createContentsOfBox(boxOrComponentData, contents);
                                }
                            }
                        } else {
                            const emptySpaceRect = table.findEmptySpace(kitData.kit.width, kitData.kit.height);

                            for (const name in kitData.kit.boxAndComponents) {
                                if (!kitData.kit.boxAndComponents.hasOwnProperty(name)) {
                                    continue;
                                }
                                const boxOrComponentData = createComponent(name);
                                layoutRelativelyAsDefined(boxOrComponentData, emptySpaceRect);

                                const contents = kitData.kit.boxAndComponents[name];
                                if (contents) {
                                    createContentsOfBox(boxOrComponentData, contents);
                                }
                            }
                        }
                    };
                case "random":
                    return function () {
                        const emptySpaceRect = table.findEmptySpace(kitData.kit.width, kitData.kit.height);

                        for (const name in kitData.kit.boxAndComponents) {
                            if (!kitData.kit.boxAndComponents.hasOwnProperty(name)) {
                                continue;
                            }
                            const boxOrComponentData = createComponent(name);
                            layoutRandomly(boxOrComponentData, emptySpaceRect);

                            const contents = kitData.kit.boxAndComponents[name];
                            if (contents) {
                                createContentsOfBox(boxOrComponentData, contents);
                            }
                        }
                    };

                default:
                    return function () {
                        const emptySpaceRect = table.findEmptySpace(kitData.kit.width, kitData.kit.height);

                        for (const name in kitData.kit.boxAndComponents) {
                            if (!kitData.kit.boxAndComponents.hasOwnProperty(name)) {
                                continue;
                            }
                            const boxOrComponentData = createComponent(name);
                            layoutRelativelyAsDefined(boxOrComponentData, emptySpaceRect);

                            const contents = kitData.kit.boxAndComponents[name];
                            if (contents) {
                                createContentsOfBox(boxOrComponentData, contents);
                            }
                        }
                    };
            }
        }
    })();


}

function removeKit(kitId) {
    table.consolidatePropagation(() => {
        const after = {};
        for (const componentId in table.data.components) {
            const cmp = table.data.components[componentId];
            if (cmp.kitId === kitId) {
                table.removeComponent(componentId);
            } else {
                after[componentId] = cmp;
            }
        }
        table.data.components = after;
        table.data.kits.splice(table.data.kits.findIndex((e) => e.kitId === kitId), 1);
    });
    pushSyncWithMe(table.data);
}

function placeNewComponent(newComponent, baseZIndex) {
    const rect = table.findEmptySpace(parseInt(newComponent.width), parseInt(newComponent.height));
    newComponent.left = rect.left + "px";
    newComponent.top = rect.top + "px";
    if (newComponent.zIndex) {
        if (baseZIndex) {
            newComponent.zIndex += baseZIndex;
        }
    } else {
        newComponent.zIndex = table.getNextZIndex();
    }

    if (newComponent.onAdd) {
        Function('"use strict"; return ' + newComponent.onAdd)()(newComponent);
    }
}

function addNewComponent(newComponentData) {
    newComponentData.componentId = generateComponentId();
    placeNewComponent(newComponentData);
    table.addComponent(newComponentData);
    pushNewComponent(newComponentData);
    return false;
}

function removeHandArea() {
    for (const componentId in table.data.components) {
        const cmp = table.data.components[componentId];
        if (cmp.handArea && cmp.owner === getPlayerName()) {
            removeComponent(componentId);
            return false;
        }
    }
    return false;
}

function removeComponent(componentId) {
    table.removeComponent(componentId);
    pushRemoveComponent(componentId);
}

function getPlayerName() {
    if (sessionStorage.getItem(SESSION_STORAGE_KEY.playerName)) {
        return sessionStorage.getItem(SESSION_STORAGE_KEY.playerName);
    }
    return "nobody";
}

function setPlayerName(playerName) {
    sessionStorage.setItem(SESSION_STORAGE_KEY.playerName, playerName);
    menu.update({ playerName: playerName });
}

function isPlayerHost() {
    return sessionStorage.getItem(SESSION_STORAGE_KEY.isHost) === "true";
}

function isPlayerObserver() {
    const value = sessionStorage.getItem(SESSION_STORAGE_KEY.status);
    return value == null || value === "observer";
}

function setPlayerIsObserver() {
    sessionStorage.setItem(SESSION_STORAGE_KEY.status, "observer");
    menu.update({});
}

function setPlayerIsJoined() {
    sessionStorage.setItem(SESSION_STORAGE_KEY.status, "joined");
    menu.update({});
}

const tablename = location.pathname.split("/")[2];
toolbox.setTableName(tablename);
document.title = tablename + " on asobann";
const container = el("div.container");
mount(document.body, container);
const table = new Table();
const tableContainer = el("div.table_container", [table.el]);
mount(container, tableContainer);

const SESSION_STORAGE_KEY = {
    playerName: "asobann: " + tablename + ": playerName",
    isHost: "asobann: " + tablename + ": isHost",
    status: "asobann: " + tablename + ": status",
};


interact("div.table_container").draggable({
    listeners: {
        move(event) {
            let left = table.el.style.left === "" ? 0 : parseFloat(table.el.style.left);
            left += event.dx;
            let top = table.el.style.top === "" ? 0 : parseFloat(table.el.style.top);
            top += event.dy;
            table.el.style.left = left + "px";
            table.el.style.top = top + "px";

            tableContainer.style.backgroundPositionX = left + "px";
            tableContainer.style.backgroundPositionY = top + "px";
        },
    },
});

function isTherePlayersHandArea(playerName) {
    if (table.data.components) {
        for (const cmpId in table.data.components) {
            const cmp = table.data.components[cmpId];
            if (cmp.handArea && cmp.owner === playerName) {
                return true;
            }
        }
    }
    return false;
}

setTableContext(tablename, sync_table_connector);

const menuConnector = {
    tablename: tablename,
    getTableData: () => {
        return table.data;
    },
    fireMenuUpdate: () => {
        menu.update(table.data);
    },
    removeComponent: removeComponent,
    getPlayerName: getPlayerName,
    addNewKit: addNewKit,
    removeKit: removeKit,
    addNewComponent: addNewComponent,
    removeHandArea: removeHandArea,
    isPlayerObserver: isPlayerObserver,
    isTherePlayersHandArea: isTherePlayersHandArea,
};

const menu = new Menu(menuConnector);
mount(container, menu.el);

tableContainer.addEventListener("mousemove", (event) => {
    if (isPlayerObserver()) {
        return;
    }
    const r = tableContainer.getBoundingClientRect();
    const mouseOnTableX = event.clientX - r.left - parseFloat(table.el.style.left);
    const mouseOnTableY = event.clientY - r.top - parseFloat(table.el.style.top);
    pushCursorMovement(getPlayerName(), {
        mouseOnTableX: mouseOnTableX,
        mouseOnTableY: mouseOnTableY,
        mouseButtons: event.buttons,
    })
});