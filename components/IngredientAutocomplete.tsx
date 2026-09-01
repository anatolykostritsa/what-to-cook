"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type IngredientSuggestion={id:string;canonical_name:string;default_unit:string|null;category:string|null};
export default function IngredientAutocomplete({householdId,value,onChange,onSelect,placeholder="Название"}:{householdId:string;value:string;onChange:(value:string)=>void;onSelect?:(item:IngredientSuggestion)=>void;placeholder?:string}){
 const supabase=useMemo(()=>createClient(),[]); const [items,setItems]=useState<IngredientSuggestion[]>([]); const [open,setOpen]=useState(false);
 useEffect(()=>{const q=value.trim(); if(q.length<2){setItems([]);return} const timer=setTimeout(async()=>{const {data}=await supabase.rpc("suggest_ingredients",{p_household_id:householdId,p_query:q,p_limit:8});setItems(data??[]);setOpen(true)},180);return()=>clearTimeout(timer)},[householdId,supabase,value]);
 return <div className="autocomplete"><input value={value} placeholder={placeholder} autoComplete="off" onChange={e=>onChange(e.target.value)} onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),120)}/>{open&&items.length>0&&<div className="autocomplete-menu">{items.map(item=><button type="button" key={item.id} onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(item.canonical_name);onSelect?.(item);setOpen(false)}}><strong>{item.canonical_name}</strong>{item.category&&<small>{item.category}</small>}</button>)}</div>}</div>
}
