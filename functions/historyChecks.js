/**
 * A list argument, however it arrived.
 *
 * THE EDIT HISTORY MUST NOT BE ABLE TO BLOCK A SAVE. These builders are called
 * on the line before the request goes out - `history = await createHistory(...)`
 * - so anything thrown in here loses the edit entirely, and does it silently:
 * no save, no error the user can act on, just a party that will not update.
 *
 * That is exactly what happened. A party with no operations recorded reached
 * createHistoryCheck as `undefined`, .forEach threw, and every edit to any of
 * the 12,716 such parties was discarded before it was sent.
 *
 * The real fix is at the source, where the column is read (see
 * functions/partyLists), because an absent list should never have got this far.
 * This is the second line of defence: a note about what changed is worth
 * nothing next to the change itself, so a missing list reads as "there was
 * nothing here before" rather than taking the save down with it.
 */
const asList = (v) => (Array.isArray(v) ? v : (v === null || v === undefined ? [] : [v]));

const createHistoryFields = (oldRec, newRec, title) => {
    return(`<div style='margin-bottom:5px;'><span className="title-rec">${title}</span><br/><span className="previous-rec">${oldRec}</span><span className="record-arrows">&#8680;</span><span className="new-rec">${newRec}</span></div>`)
}

const createHistoryCompanies = (listArg, oldRecArg, newRecArg, title) => {
    const list = asList(listArg);
    const oldRec = asList(oldRecArg);
    const newRec = asList(newRecArg);
    let changedValues = "";
    let oldValues = "";
    list.forEach((x)=>{
        oldRec.forEach((y)=>{
            if(x.id==y){
                oldValues = oldValues + `<span className="previous-rec"> ${x.title} </span><span className="mx-1"></span>`;
                return;
            }
        })
        newRec.forEach((y)=>{
            if(x.id==y){
                changedValues = changedValues + `<span className="new-rec"> ${x.title} </span><span className="mx-1"></span>`;
                return;
            }
        })
    })

    let tempSring =`
    <div style='margin-bottom:5px;'><span className="title-rec">${title}</span><br/>${oldValues}<span className="record-arrows">&#8680;</span>${changedValues}</div>`;

    return [...getDifference(newRec,oldRec),...getDifference(oldRec,newRec)].length>0?tempSring:"";
}

const createHistoryCheck = (oldRecArg, newRecArg, title) => {
    const oldRec = asList(oldRecArg);
    const newRec = asList(newRecArg);
    let changedValues = "";
    let oldValues = "";

    oldRec.forEach((x)=>{ oldValues = oldValues + `<span className="previous-rec"> ${x} </span>` })
    newRec.forEach((x)=>{ changedValues = changedValues + `<span className="new-rec">${x}</span>` })

    let tempSring =`
    <div style='margin-bottom:5px;'><span className="title-rec">${title}</span><br/>${oldValues}<span className="record-arrows">&#8680;</span>${changedValues}</div>`;

    return [...getDifference(newRec,oldRec),...getDifference(oldRec,newRec)].length>0?tempSring:"";
}

// const createHistorySelect = (list, oldRec, newRec, title) => {
//     console.log(oldRec)
//     console.log(Rec)
//     let tempHtml = '';
//     let changedValues = [];
//     list.forEach((x) => {
//         if(x.id==oldRec) {
//             changedValues.push(x.name);
//         }else if(x.id==newRec) {
//             changedValues.push(x.name);
//         }
//     });
//     changedValues.forEach((x, i) => {
//         if(i%2==0 && changedValues[i+1]!=undefined){
//             tempHtml = tempHtml +`<div style='margin-bottom:5px;'><span className="title-rec">${title}</span><br/><span className="previous-rec">${changedValues[i]}</span><span className="record-arrows">&#8680;</span><span className="new-rec">${changedValues[i+1]}</span></div>`
//         }
//     })
//     return tempHtml
// }

const createHistorySelect = (listArg, oldRec, newRec, title) => {

    const getName = (id) => {
        let val = '';
        asList(listArg).forEach((x)=>{
            if(x.id==id){
                val=x.name
            }
        })
        return val;
    }
    return oldRec!=newRec?`<div style='margin-bottom:5px;'><span className="title-rec">${title}</span><br/><span className="previous-rec">${getName(oldRec)}</span><span className="record-arrows">&#8680;</span><span className="new-rec">${getName(newRec)}</span></div>`:''
}

function getDifference(array1, array2){
    return array1.filter(object1 => {
        return !array2.some(object2 => {
            return object1 === object2;
        });
    });
}

export { createHistoryFields, createHistoryCompanies, createHistoryCheck, createHistorySelect }