--Wicked Booster Zero Motor
--Scripted by: XGlitchy30

local s,id,o=GetID()
Duel.LoadScript("glitchylib.lua")
function s.initial_effect(c)
	--summon with no tribute
	local e1=Effect.CreateEffect(c)
	e1:SetDescription(aux.Stringid(id,0))
	e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
	e1:SetType(EFFECT_TYPE_SINGLE)
	e1:SetCode(EFFECT_SUMMON_PROC)
	e1:SetCondition(s.ntcon)
	e1:SetOperation(s.ntop)
	c:RegisterEffect(e1)
	--draw
	c:SummonedTrigger(false,true,true,false,1,CATEGORY_TOGRAVE,true,{true,true},
		nil,
		nil,
		aux.SendToGYTarget(s.tgfilter,LOCATION_DECK),
		aux.SendToGYOperation(s.tgfilter,LOCATION_DECK)
	)
	--token
	c:BanishedTrigger(false,2,CATEGORY_REMOVE,true,{true,true},
		s.tkcon,
		nil,
		aux.BanishTarget(nil,LOCATION_GRAVE,LOCATION_GRAVE),
		aux.BanishOperation(nil,LOCATION_GRAVE,LOCATION_GRAVE)
	)
end
function s.ntcon(e,c,minc)
	if c==nil then return true end
	return minc==0 and c:GetLevel()>4 and Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0
end
function s.ntop(e,tp,eg,ep,ev,re,r,rp,c)
	local rct=(Duel.IsEndPhase(1-tp)) and 2 or 1
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_SINGLE)
	e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
	e1:SetRange(LOCATION_MZONE)
	e1:SetReset(RESET_EVENT+RESETS_STANDARD_DISABLE-RESET_TOFIELD+RESET_PHASE+PHASE_END+RESET_TURN_OPPO,rct)
	e1:SetCode(EFFECT_SET_ATTACK)
	e1:SetValue(0)
	c:RegisterEffect(e1)
end

function s.tgfilter(c)
	return c:IsMonster() and c:IsSetCard(SET_WICKED_BOOSTER)
end

function s.tkcon(e,tp,eg,ep,ev,re,r,rp)
	return re and re:IsActivated() and r&(REASON_EFFECT|REASON_COST)>0
		and Duel.IsExistingMatchingCard(aux.FaceupFilter(s.tgfilter),tp,LOCATION_MZONE,0,1,nil)
end